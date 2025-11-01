'use client';

import { use, useEffect, useMemo, useState } from 'react';

import { supabase } from '../../../../lib/supabaseClient';
import { useRouter } from 'next/navigation';

type Race = {
	id: number;
	name: string;
	date: string | null;
	location: string | null;
	status: string | null;
};

type ParticipantBrief = {
	id: number;
	first_name: string;
	last_name: string;
	dni: string | null;
	sex: string;
	distance_km: number | null;
	bib_number: number | null;
	chip: string | null;
};

export default function LookupPage({
	params,
}: {
	params: Promise<{ raceId: string }>;
}) {
	const { raceId } = use(params);
	const raceIdNum = Number(raceId);
	const router = useRouter();

	const [race, setRace] = useState<Race | null>(null);
	const [q, setQ] = useState('');
	const [loading, setLoading] = useState(false);
	const [results, setResults] = useState<ParticipantBrief[]>([]);
	const [err, setErr] = useState('');

	useEffect(() => {
		(async () => {
			const { data, error } = await supabase
				.from('races')
				.select('id,name,date,location,status')
				.eq('id', raceIdNum)
				.single();
			if (error) {
				console.error(error);
				setRace(null);
			} else {
				setRace(data as Race);
			}
		})();
	}, [raceIdNum]);

	const qTrim = useMemo(() => q.trim(), [q]);

	async function doSearch() {
		setErr('');
		setLoading(true);
		setResults([]);

		if (!qTrim) {
			setLoading(false);
			return;
		}

		// Buscamos por apellido, nombre o DNI (case-insensitive).
		// Nota: el DNI en base está “limpio” (solo dígitos).
		const pattern = `%${qTrim}%`;
		const { data, error } = await supabase
			.from('participants')
			.select(
				`
        id,
        first_name,
        last_name,
        dni,
        sex,
        distance_km,
        bib_number,
        chip
      `
			)
			.eq('race_id', raceIdNum)
			.or(
				`last_name.ilike.${pattern},first_name.ilike.${pattern},dni.ilike.${pattern}`
			)
			.order('last_name', { ascending: true })
			.order('first_name', { ascending: true })
			.limit(100);

		if (error) {
			console.error(error);
			setErr('No se pudo realizar la búsqueda.');
			setResults([]);
		} else {
			setResults((data || []) as ParticipantBrief[]);
		}
		setLoading(false);
	}

	function goToParticipant(pId: number) {
		router.push(`/race/${raceIdNum}/participant/${pId}`);
	}

	function goHome() {
		router.push('/');
	}

	return (
		<main className='min-h-screen bg-neutral-950 text-white p-4'>
			<div className='max-w-3xl mx-auto'>
				{/* Header */}
				<div className='flex items-center justify-between mb-4'>
					<div className='min-w-0'>
						<div className='text-sm text-neutral-400'>
							<button className='underline text-neutral-300' onClick={goHome}>
								← Elegir otra carrera
							</button>
						</div>
						<h1 className='text-2xl font-bold leading-tight mt-1'>
							Buscador · {race?.name ?? 'Carrera'}
						</h1>
						<div className='text-sm text-neutral-400'>
							{race?.date || ''} {race?.location ? `· ${race.location}` : ''}
						</div>
					</div>
				</div>

				{/* Buscador */}
				<div className='border border-neutral-800 bg-neutral-900 rounded-2xl p-4 mb-4'>
					<label className='text-sm text-neutral-300'>
						Buscar por apellido, nombre o DNI
					</label>
					<div className='mt-2 flex gap-2'>
						<input
							value={q}
							onChange={(e) => setQ(e.target.value)}
							onKeyDown={(e) => e.key === 'Enter' && doSearch()}
							placeholder="Ej.: 'GARCIA', 'Ana', '30123456'"
							className='w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm'
						/>
						<button
							onClick={doSearch}
							className='shrink-0 bg-emerald-600 text-white font-semibold px-4 rounded-lg text-sm active:scale-95 disabled:opacity-50'
							disabled={!qTrim || loading}
						>
							{loading ? 'Buscando…' : 'Buscar'}
						</button>
					</div>
					{err && <div className='mt-3 text-red-400 text-sm'>{err}</div>}
					<div className='mt-2 text-[11px] text-neutral-500'>
						Máximo 100 resultados. Acceso de solo lectura.
					</div>
				</div>

				{/* Resultados */}
				<div className='border border-neutral-800 bg-neutral-900 rounded-2xl overflow-hidden'>
					<table className='min-w-full text-left text-sm text-neutral-200'>
						<thead className='bg-neutral-800 text-[11px] uppercase text-neutral-400'>
							<tr>
								<th className='px-3 py-2'>Nombre</th>
								<th className='px-3 py-2'>DNI</th>
								<th className='px-3 py-2'>Sexo</th>
								<th className='px-3 py-2'>Dist</th>
								<th className='px-3 py-2'>Dorsal</th>
								<th className='px-3 py-2'>Chip</th>
								<th className='px-3 py-2'></th>
							</tr>
						</thead>
						<tbody>
							{results.length === 0 ? (
								<tr>
									<td
										className='px-3 py-4 text-center text-neutral-500'
										colSpan={7}
									>
										{loading
											? 'Buscando…'
											: qTrim
											? 'Sin resultados.'
											: 'Ingresá un texto para buscar.'}
									</td>
								</tr>
							) : (
								results.map((p, idx) => (
									<tr
										key={p.id}
										className={
											idx % 2 === 0 ? 'bg-neutral-900' : 'bg-neutral-950/40'
										}
									>
										<td className='px-3 py-2'>
											<div className='text-white font-semibold'>
												{p.last_name}, {p.first_name}
											</div>
										</td>
										<td className='px-3 py-2'>{p.dni ?? '—'}</td>
										<td className='px-3 py-2'>{p.sex || '—'}</td>
										<td className='px-3 py-2'>
											{p.distance_km != null ? `${p.distance_km}K` : '—'}
										</td>
										<td className='px-3 py-2'>
											{p.bib_number != null ? `#${p.bib_number}` : '—'}
										</td>
										<td className='px-3 py-2 font-mono'>{p.chip ?? '—'}</td>
										<td className='px-3 py-2'>
											<button
												onClick={() => goToParticipant(p.id)}
												className='bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 rounded-lg px-3 py-1 text-sm'
											>
												Ver ficha
											</button>
										</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>

				{/* Nota de acceso */}
				<div className='mt-3 text-[11px] text-neutral-500'>
					* Este módulo no permite editar ni cargar datos. El resto queda oculto
					en la sección de administración.
				</div>
			</div>
		</main>
	);
}
