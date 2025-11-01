'use client';

import { useEffect, useState } from 'react';

import { supabase } from '../../../../../lib/supabaseClient';
import { use } from 'react';
import { useRouter } from 'next/navigation';

type ParticipantFull = {
	id: number;
	race_id: number;
	first_name: string;
	last_name: string;
	dni: string | null;
	sex: string;
	birth_date: string | null;
	age: number | null;
	distance_km: number | null;
	bib_number: number | null;
	chip: string | null;
	category_id: number | null;
	category?: { name: string }[]; // relación opcional
};

type Race = {
	id: number;
	name: string;
	date: string | null;
	location: string | null;
};

export default function ParticipantDetailPage({
	params,
}: {
	params: Promise<{ raceId: string; participantId: string }>;
}) {
	const { raceId, participantId } = use(params);
	const raceIdNum = Number(raceId);
	const pId = Number(participantId);

	const router = useRouter();

	const [race, setRace] = useState<Race | null>(null);
	const [p, setP] = useState<ParticipantFull | null>(null);
	const [err, setErr] = useState('');

	useEffect(() => {
		(async () => {
			setErr('');

			const [{ data: r, error: er }, { data: pf, error: ep }] =
				await Promise.all([
					supabase
						.from('races')
						.select('id,name,date,location')
						.eq('id', raceIdNum)
						.single(),
					supabase
						.from('participants')
						.select(
							`
              id,
              race_id,
              first_name,
              last_name,
              dni,
              sex,
              birth_date,
              age,
              distance_km,
              bib_number,
              chip,
              category_id,
              category(name)
            `
						)
						.eq('race_id', raceIdNum)
						.eq('id', pId)
						.single(),
				]);

			if (er) {
				console.error(er);
			} else {
				setRace(r as Race);
			}

			if (ep) {
				console.error(ep);
				setErr('No se pudo cargar el participante.');
				setP(null);
			} else {
				setP(pf as ParticipantFull);
			}
		})();
	}, [raceIdNum, pId]);

	function goBack() {
		router.back();
	}

	return (
		<main className='min-h-screen bg-neutral-950 text-white p-4'>
			<div className='max-w-3xl mx-auto'>
				{/* Header */}
				<div className='flex items-center justify-between mb-4'>
					<div className='min-w-0'>
						<div className='text-sm text-neutral-400'>
							<button className='underline text-neutral-300' onClick={goBack}>
								← Volver al buscador
							</button>
						</div>
						<h1 className='text-2xl font-bold leading-tight mt-1'>
							Ficha del participante
						</h1>
						<div className='text-sm text-neutral-400'>
							{race?.name || 'Carrera'} {race?.date ? `· ${race.date}` : ''}{' '}
							{race?.location ? `· ${race.location}` : ''}
						</div>
					</div>
				</div>

				{/* Contenido */}
				<div className='border border-neutral-800 bg-neutral-900 rounded-2xl overflow-hidden'>
					{err ? (
						<div className='p-4 text-red-400'>{err}</div>
					) : !p ? (
						<div className='p-4 text-neutral-400'>Cargando…</div>
					) : (
						<div className='divide-y divide-neutral-800'>
							<div className='p-4 grid grid-cols-1 sm:grid-cols-2 gap-4'>
								<Field label='Nombre y apellido'>
									<span className='font-semibold'>
										{p.last_name}, {p.first_name}
									</span>
								</Field>
								<Field label='DNI'>{p.dni ?? '—'}</Field>
								<Field label='Sexo'>{p.sex || '—'}</Field>
								<Field label='Fecha de nacimiento'>{p.birth_date ?? '—'}</Field>
								<Field label='Edad'>{p.age != null ? p.age : '—'}</Field>
								<Field label='Distancia'>
									{p.distance_km != null ? `${p.distance_km}K` : '—'}
								</Field>
								<Field label='Dorsal'>
									{p.bib_number != null ? `#${p.bib_number}` : '—'}
								</Field>
								<Field label='Chip' mono>
									{p.chip ?? '—'}
								</Field>
								<Field label='Categoría'>
									{p.category && p.category.length > 0
										? p.category[0].name
										: p.category_id != null
										? `ID ${p.category_id}`
										: '—'}
								</Field>
							</div>

							<div className='p-4 text-[11px] text-neutral-500'>
								Acceso de solo lectura. Para altas/edición/crono, se utiliza la
								sección de administración.
							</div>
						</div>
					)}
				</div>
			</div>
		</main>
	);
}

function Field({
	label,
	children,
	mono,
}: {
	label: string;
	children: React.ReactNode;
	mono?: boolean;
}) {
	return (
		<div className='flex flex-col'>
			<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
				{label}
			</div>
			<div
				className={`mt-1 text-sm ${
					mono ? 'font-mono text-neutral-200' : 'text-white'
				}`}
			>
				{children}
			</div>
		</div>
	);
}
