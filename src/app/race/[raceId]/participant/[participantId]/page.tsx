'use client';

import { useEffect, useState } from 'react';

import { supabase } from '../../../../../lib/supabaseClient';
import { use } from 'react';
import { useRouter } from 'next/navigation';

type Race = {
	id: number;
	name: string;
	date: string | null;
	location: string | null;
};

type ParticipantDB = {
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
};

type CategoryDB = {
	id: number;
	name: string;
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
	const [participant, setParticipant] = useState<ParticipantDB | null>(null);
	const [categoryName, setCategoryName] = useState<string>('—');

	const [err, setErr] = useState('');
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;

		async function load() {
			setErr('');
			setLoading(true);

			// 1. Traemos la carrera
			const { data: rData, error: rErr } = await supabase
				.from('races')
				.select('id,name,date,location')
				.eq('id', raceIdNum)
				.single();

			if (!cancelled) {
				if (rErr) {
					console.error(rErr);
					setRace(null);
				} else {
					setRace(rData as Race);
				}
			}

			// 2. Traemos el participante SIN intentar hacer join automático
			const { data: pData, error: pErr } = await supabase
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
          category_id
        `
				)
				.eq('race_id', raceIdNum)
				.eq('id', pId)
				.single();

			if (pErr) {
				console.error(pErr);
				if (!cancelled) {
					setErr('No se pudo cargar el participante.');
					setParticipant(null);
					setCategoryName('—');
					setLoading(false);
				}
				return;
			}

			if (cancelled) return;

			const pRow = pData as ParticipantDB;
			setParticipant(pRow);

			// 3. Si tiene category_id, buscamos el nombre de la categoría aparte
			if (pRow.category_id != null) {
				const { data: cData, error: cErr } = await supabase
					.from('categories')
					.select('id,name')
					.eq('id', pRow.category_id)
					.single();

				if (cErr) {
					console.error(cErr);
					if (!cancelled) {
						setCategoryName(`ID ${pRow.category_id}`);
					}
				} else if (cData) {
					const cat = cData as CategoryDB;
					if (!cancelled) {
						setCategoryName(cat.name || `ID ${pRow.category_id}`);
					}
				} else {
					if (!cancelled) {
						setCategoryName(`ID ${pRow.category_id}`);
					}
				}
			} else {
				setCategoryName('—');
			}

			setLoading(false);
		}

		load();
		return () => {
			cancelled = true;
		};
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
							{race?.name || 'Carrera'}
							{race?.date ? ` · ${race.date}` : ''}{' '}
							{race?.location ? `· ${race.location}` : ''}
						</div>
					</div>
				</div>

				{/* Tarjeta */}
				<div className='border border-neutral-800 bg-neutral-900 rounded-2xl overflow-hidden'>
					{loading ? (
						<div className='p-4 text-neutral-400'>Cargando…</div>
					) : err ? (
						<div className='p-4 text-red-400'>{err}</div>
					) : !participant ? (
						<div className='p-4 text-neutral-400'>
							Participante no encontrado.
						</div>
					) : (
						<div className='divide-y divide-neutral-800'>
							{/* Datos principales */}
							<div className='p-4 grid grid-cols-1 sm:grid-cols-2 gap-4'>
								<Field label='Nombre y apellido'>
									<span className='font-semibold'>
										{participant.last_name}, {participant.first_name}
									</span>
								</Field>

								<Field label='DNI'>{participant.dni ?? '—'}</Field>

								<Field label='Sexo'>{participant.sex || '—'}</Field>

								<Field label='Fecha de nacimiento'>
									{participant.birth_date ?? '—'}
								</Field>

								<Field label='Edad'>
									{participant.age != null ? participant.age : '—'}
								</Field>

								<Field label='Distancia'>
									{participant.distance_km != null
										? `${participant.distance_km}K`
										: '—'}
								</Field>

								<Field label='Dorsal'>
									{participant.bib_number != null
										? `#${participant.bib_number}`
										: '—'}
								</Field>

								<Field label='Chip' mono>
									{participant.chip ?? '—'}
								</Field>

								<Field label='Categoría'>{categoryName || '—'}</Field>
							</div>

							<div className='p-4 text-[11px] text-neutral-500'>
								Acceso de solo lectura. Carga, edición y cronometraje están
								reservados al administrador.
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
