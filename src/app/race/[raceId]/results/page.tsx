'use client';

import { use, useEffect, useState } from 'react';

import { supabase } from '../../../../lib/supabaseClient';
import { useRouter } from 'next/navigation';

type Race = {
	id: number;
	name: string;
	date: string;
	location: string | null;
	status: string;
};

// De nuevo: Supabase nos devuelve participant como array.
type ResultParticipant = {
	id: number;
	bib_number: number | null;
	first_name: string;
	last_name: string;
	sex: string;
	distance_km: number | null;
	category_id: number | null;
	category: { name: string }[];
};

type ResultRow = {
	id: number; // finish_times.id
	recorded_at: string;
	participant: ResultParticipant[]; // array, tomamos [0]
};

export default function ResultsPage({
	params,
}: {
	params: Promise<{ raceId: string }>;
}) {
	const { raceId: raceIdStr } = use(params);
	const raceId = Number(raceIdStr);
	const router = useRouter();

	const [race, setRace] = useState<Race | null>(null);
	const [results, setResults] = useState<ResultRow[]>([]);
	const [loading, setLoading] = useState(true);

	// -------------------------------------------------
	// Cargar carrera + resultados
	// -------------------------------------------------
	async function loadData() {
		setLoading(true);

		const { data: raceData, error: raceErr } = await supabase
			.from('races')
			.select('id, name, date, location, status')
			.eq('id', raceId)
			.single();

		if (raceErr) {
			console.error('Error cargando carrera:', raceErr);
			setRace(null);
		} else {
			setRace(raceData as Race);
		}

		// finish_times ordenado por recorded_at asc => primero que llegó va primero
		const { data: finData, error: finErr } = await supabase
			.from('finish_times')
			.select(
				`
        id,
        recorded_at,
        participant:participant_id(
          id,
          bib_number,
          first_name,
          last_name,
          sex,
          distance_km,
          category_id,
          category:category_id(name)
        )
      `
			)
			.eq('race_id', raceId)
			.order('recorded_at', { ascending: true });

		if (finErr) {
			console.error('Error cargando resultados:', finErr);
			setResults([]);
		} else {
			setResults(finData as unknown as ResultRow[]);
		}

		setLoading(false);
	}

	useEffect(() => {
		loadData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [raceId]);

	// -------------------------------------------------
	// Helpers visuales
	// -------------------------------------------------
	function formatClock(ts: string) {
		const d = new Date(ts);
		if (isNaN(d.getTime())) return '—';
		return d.toLocaleTimeString();
	}

	// -------------------------------------------------
	// Render
	// -------------------------------------------------

	if (loading && !race) {
		return (
			<main className='min-h-screen bg-neutral-950 text-white p-4'>
				<div className='text-neutral-400 text-sm'>
					Cargando clasificación...
				</div>
			</main>
		);
	}

	if (!race) {
		return (
			<main className='min-h-screen bg-neutral-950 text-white p-4'>
				<div className='text-red-400 mb-4'>Carrera no encontrada</div>
				<button
					className='bg-neutral-800 border border-neutral-600 rounded-lg px-4 py-2 text-white'
					onClick={() => router.push('/')}
				>
					Volver
				</button>
			</main>
		);
	}

	return (
		<main className='min-h-screen bg-neutral-950 text-white p-4 pb-24'>
			{/* HEADER */}
			<div className='flex flex-col gap-1 mb-4'>
				<div className='text-sm text-neutral-400 flex items-center gap-2 flex-wrap'>
					<button
						className='underline text-neutral-300'
						onClick={() => router.push(`/race/${raceId}`)}
					>
						← {race.name}
					</button>
					<span className='text-neutral-600'>/</span>
					<span>Clasificación</span>
				</div>

				<div className='min-w-0'>
					<h1 className='text-2xl font-bold leading-tight break-words'>
						Resultados oficiales
					</h1>
					<div className='text-sm text-neutral-400'>
						{race.date} · {race.location || 'Sin ubicación'}
					</div>
					<div className='text-[11px] text-neutral-500 mt-1'>
						Estado:{' '}
						<span
							className={
								race.status === 'open'
									? 'text-emerald-400'
									: race.status === 'closed'
									? 'text-red-400'
									: 'text-neutral-300'
							}
						>
							{race.status || '—'}
						</span>
					</div>
				</div>
			</div>

			{/* TABLA RESULTADOS */}
			{results.length === 0 ? (
				<div className='text-neutral-400 text-sm'>
					Aún no hay llegadas registradas.
				</div>
			) : (
				<div className='border border-neutral-700 bg-neutral-900 rounded-xl overflow-hidden'>
					<div className='overflow-x-auto'>
						<table className='min-w-full text-left text-sm text-neutral-200'>
							<thead className='bg-neutral-800 text-[11px] uppercase text-neutral-400'>
								<tr>
									<th className='px-3 py-2 whitespace-nowrap'>Pos</th>
									<th className='px-3 py-2 whitespace-nowrap'>Dorsal</th>
									<th className='px-3 py-2 whitespace-nowrap'>Nombre</th>
									<th className='px-3 py-2 whitespace-nowrap'>Sexo</th>
									<th className='px-3 py-2 whitespace-nowrap'>Dist</th>
									<th className='px-3 py-2 whitespace-nowrap'>Categoría</th>
									<th className='px-3 py-2 whitespace-nowrap'>Hora llegada</th>
								</tr>
							</thead>
							<tbody>
								{results.map((r, idx) => {
									// agarramos al corredor del array
									const runner =
										r.participant && r.participant[0] ? r.participant[0] : null;

									return (
										<tr
											key={r.id}
											className={
												idx % 2 === 0 ? 'bg-neutral-900' : 'bg-neutral-950/40'
											}
										>
											<td className='px-3 py-2 text-white font-semibold text-[13px]'>
												{idx + 1}
											</td>
											<td className='px-3 py-2 text-white font-semibold text-[13px]'>
												#{runner?.bib_number ?? '—'}
											</td>
											<td className='px-3 py-2'>
												<div className='text-white text-[13px] font-semibold leading-tight'>
													{runner
														? `${runner.first_name} ${runner.last_name}`
														: '—'}
												</div>
											</td>
											<td className='px-3 py-2 text-[13px] text-neutral-300'>
												{runner?.sex ?? '—'}
											</td>
											<td className='px-3 py-2 text-[13px] text-neutral-300'>
												{runner?.distance_km != null
													? `${runner.distance_km}K`
													: '—'}
											</td>
											<td className='px-3 py-2 text-[13px] text-neutral-300'>
												{runner?.category && runner.category.length > 0
													? runner.category[0].name
													: '—'}
											</td>
											<td className='px-3 py-2 text-[13px] text-neutral-300'>
												{formatClock(r.recorded_at)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>

					<div className='p-3 text-[10px] text-neutral-500 border-t border-neutral-800'>
						Ordenado por llegada (el primero que cruzó, primero en la tabla).
						Próximo paso: guardar y mostrar tiempo neto (mm:ss.mmm).
					</div>
				</div>
			)}

			{/* ROADMAP */}
			<div className='mt-6 text-[11px] text-neutral-500 leading-relaxed border-t border-neutral-800 pt-4'>
				<div className='mb-2 font-medium text-neutral-300 text-[12px]'>
					Próximo upgrade:
				</div>
				<ul className='list-disc list-inside space-y-1'>
					<li>
						Guardar <span className='text-neutral-300'>elapsed_ms</span> en
						`finish_times` y formatear mm:ss.mmm.
					</li>
					<li>Filtros rápidos (por distancia, sexo, categoría activa).</li>
					<li>Exportar a Excel/CSV.</li>
				</ul>
			</div>
		</main>
	);
}
