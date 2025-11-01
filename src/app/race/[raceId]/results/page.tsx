'use client';

import { use, useEffect, useState } from 'react';

import { supabase } from '../../../../lib/supabaseClient';
import { useRouter } from 'next/navigation';

/**
 * ResultRow:
 * Lo que TERMINAMOS mostrando en pantalla para cada corredor.
 * Es el "mejor tiempo" consolidado por participante.
 */
type ResultRow = {
	participant_id: number;
	bib_number: string | null;
	first_name: string;
	last_name: string;
	sex: string;
	distance_km: number;
	category_id: number | null;
	category_name: string | null;
	best_elapsed_ms: number;
};

/**
 * CategoryOption:
 * Para el combo de filtrado por categoría.
 */
type CategoryOption = {
	id: number;
	name: string;
};

/**
 * TimelogWithParticipant:
 * Esto representa UNA FILA que viene de Supabase en la query a timelogs,
 * incluyendo el join con participants y con la categoría del participante.
 *
 * Ojo: Supabase devuelve arrays u objetos anidados con las claves que
 * pusimos en el select. Le marcamos "any" en algunos campos que pueden
 * venir null o indefinidos para que TS no rompa las bolas.
 */
type TimelogWithParticipant = {
	id: number;
	participant_id: number;
	elapsed_ms: number;
	type: string;
	participant: {
		bib_number: string | null;
		first_name: string;
		last_name: string;
		sex: string;
		distance_km: number;
		category_id: number | null;
		category: {
			name: string;
		} | null;
	} | null;
};

export default function ResultsPage({
	params,
}: {
	params: Promise<{ raceId: string }>;
}) {
	const router = useRouter();

	// Next 16: params es Promise. Lo desempaquetamos con use()
	const { raceId: raceIdStr } = use(params);
	const raceId = Number(raceIdStr);

	// Estado UI
	const [loading, setLoading] = useState(true);
	const [raceName, setRaceName] = useState<string>('');

	const [allResults, setAllResults] = useState<ResultRow[]>([]);
	const [categories, setCategories] = useState<CategoryOption[]>([]);
	const [selectedCat, setSelectedCat] = useState<number | 'ALL'>('ALL');

	/**
	 * Dado msA y baseMs, devolvemos string "hh:mm:ss.mmm"
	 * usando la diferencia (msA - baseMs). Eso nos da tiempos relativos
	 * entre corredores, suficiente para ordenar y cantar podio.
	 *
	 * Más adelante vamos a reemplazar esto por tiempo oficial neto
	 * (elapsed_ms - gun_start_ms_de_su_distancia).
	 */
	function formatDiffMs(msA: number, baseMs: number): string {
		const diff = msA - baseMs; // el primero queda 0
		let remaining = diff;

		const hours = Math.floor(remaining / (1000 * 60 * 60));
		remaining -= hours * (1000 * 60 * 60);

		const minutes = Math.floor(remaining / (1000 * 60));
		remaining -= minutes * (1000 * 60);

		const seconds = Math.floor(remaining / 1000);
		const millis = remaining - seconds * 1000;

		const hh = hours.toString().padStart(2, '0');
		const mm = minutes.toString().padStart(2, '0');
		const ss = seconds.toString().padStart(2, '0');
		const msStr = millis.toString().padStart(3, '0');

		return `${hh}:${mm}:${ss}.${msStr}`;
	}

	/**
	 * loadData:
	 * - Trae nombre de la carrera
	 * - Trae categorías activas para el filtro
	 * - Trae timelogs (llegadas) + datos del participante
	 * - Arma el "mejor tiempo por participante"
	 */
	async function loadData() {
		setLoading(true);

		// 1. Info de la carrera (sólo nombre)
		{
			const { data, error } = await supabase
				.from('races')
				.select('name')
				.eq('id', raceId)
				.single();

			if (error) {
				console.error('Error cargando carrera:', error);
				setRaceName('(carrera)');
			} else {
				setRaceName(data?.name || '(carrera)');
			}
		}

		// 2. Categorías activas de esta carrera (para el combo)
		{
			const { data, error } = await supabase
				.from('categories')
				.select('id, name')
				.eq('race_id', raceId)
				.eq('is_active', true)
				.order('name', { ascending: true });

			if (error) {
				console.error('Error cargando categorías:', error);
				setCategories([]);
			} else {
				const opts: CategoryOption[] = (data || []).map((c: any) => ({
					id: c.id,
					name: c.name,
				}));
				setCategories(opts);
			}
		}

		// 3. Traer timelogs (llegadas) con participante y categoría
		//
		// IMPORTANTE:
		//  - Sólo type = 'finish'.
		//  - Juntamos participant.* y participant.category.name
		//
		// Supabase nos va a devolver un array de TimelogWithParticipant.
		const { data: logsData, error: logsErr } = await supabase
			.from('timelogs')
			.select(
				`
        id,
        participant_id,
        elapsed_ms,
        type,
        participant:participant_id (
          bib_number,
          first_name,
          last_name,
          sex,
          distance_km,
          category_id,
          category:category_id (
            name
          )
        )
      `
			)
			.eq('race_id', raceId)
			.eq('type', 'finish');

		if (logsErr) {
			console.error('Error cargando timelogs:', logsErr);
			setAllResults([]);
			setLoading(false);
			return;
		}

		// Seguridad: casteamos explícitamente para que TS entienda.
		const safeLogs: TimelogWithParticipant[] = (logsData || []).map(
			(row: any): TimelogWithParticipant => ({
				id: row.id,
				participant_id: row.participant_id,
				elapsed_ms: row.elapsed_ms,
				type: row.type,
				participant: row.participant
					? {
							bib_number: row.participant.bib_number ?? null,
							first_name: row.participant.first_name ?? '',
							last_name: row.participant.last_name ?? '',
							sex: row.participant.sex ?? '',
							distance_km: row.participant.distance_km ?? 0,
							category_id:
								row.participant.category_id === null ||
								row.participant.category_id === undefined
									? null
									: row.participant.category_id,
							category: row.participant.category
								? {
										name: row.participant.category.name ?? '',
								  }
								: null,
					  }
					: null,
			})
		);

		// 4. Para cada participante, quedarnos con el mejor (menor) elapsed_ms
		// Creamos un diccionario indexed por participant_id
		const bestByRunner: Record<number, ResultRow> = {};

		for (const row of safeLogs) {
			if (!row.participant) {
				continue;
			}

			const pid = row.participant_id;
			const thisMs = Number(row.elapsed_ms);

			const maybeExisting = bestByRunner[pid];

			if (!maybeExisting || thisMs < maybeExisting.best_elapsed_ms) {
				bestByRunner[pid] = {
					participant_id: pid,
					bib_number: row.participant.bib_number ?? null,
					first_name: row.participant.first_name ?? '',
					last_name: row.participant.last_name ?? '',
					sex: row.participant.sex ?? '',
					distance_km: row.participant.distance_km ?? 0,
					category_id:
						row.participant.category_id === undefined
							? null
							: row.participant.category_id,
					category_name: row.participant.category
						? row.participant.category.name
						: null,
					best_elapsed_ms: thisMs,
				};
			}
		}

		// 5. Pasamos el diccionario a array y ordenamos por mejor tiempo ascendente
		const arr = Object.values(bestByRunner).sort(
			(a, b) => a.best_elapsed_ms - b.best_elapsed_ms
		);

		setAllResults(arr);
		setLoading(false);
	}

	useEffect(() => {
		loadData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [raceId]);

	// Filtrar por categoría (combo)
	const filtered = allResults.filter((r) => {
		if (selectedCat === 'ALL') return true;
		return r.category_id === selectedCat;
	});

	// Referencia para calcular los tiempos relativos
	const baseTime =
		filtered.length > 0 ? filtered[0].best_elapsed_ms : Date.now();

	return (
		<main className='min-h-screen bg-neutral-950 text-white p-4 pb-24 flex flex-col gap-4'>
			{/* HEADER */}
			<div className='flex flex-col gap-2'>
				<div className='text-sm text-neutral-400 flex items-center gap-2'>
					<button
						className='underline text-neutral-300'
						onClick={() => router.push(`/race/${raceId}`)}
					>
						← Volver
					</button>
					<span className='text-neutral-600'>/</span>
					<span className='text-neutral-400'>Resultados</span>
				</div>

				<div className='flex flex-col'>
					<div className='text-2xl font-bold leading-tight'>
						{raceName || 'Carrera'}
					</div>
					<div className='text-sm text-neutral-400'>
						Clasificación provisoria
					</div>
				</div>
			</div>

			{/* FILTRO DE CATEGORÍA */}
			<div className='flex flex-col gap-2 bg-neutral-900 border border-neutral-700 rounded-xl p-3'>
				<label className='text-xs text-neutral-400'>
					Filtrar por categoría
				</label>
				<select
					className='rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-sm'
					value={selectedCat}
					onChange={(e) => {
						const v = e.target.value;
						if (v === 'ALL') {
							setSelectedCat('ALL');
						} else {
							setSelectedCat(Number(v));
						}
					}}
				>
					<option value='ALL'>Todas las categorías</option>
					{categories.map((c) => (
						<option key={c.id} value={c.id}>
							{c.name}
						</option>
					))}
				</select>
			</div>

			{/* TABLA / LISTA DE RESULTADOS */}
			<section className='flex flex-col gap-2'>
				{loading ? (
					<div className='text-neutral-400 text-sm'>Cargando resultados...</div>
				) : filtered.length === 0 ? (
					<div className='text-neutral-400 text-sm'>
						No hay llegadas registradas todavía.
					</div>
				) : (
					<ul className='flex flex-col gap-2'>
						{filtered.map((res, index) => (
							<li
								key={res.participant_id}
								className='rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-sm flex flex-col'
							>
								{/* fila principal: posición + nombre + dorsal */}
								<div className='flex justify-between items-start'>
									<div className='flex flex-col'>
										<div className='text-xl font-bold leading-none'>
											#{index + 1}
										</div>

										<div className='font-semibold leading-tight'>
											{res.last_name.toUpperCase()}, {res.first_name}
										</div>

										<div className='text-neutral-400 text-xs leading-tight'>
											Dorsal {res.bib_number || 's/d'} · {res.sex} ·{' '}
											{res.distance_km}K
										</div>
									</div>

									<div className='text-right text-xs text-neutral-400'>
										<div className='font-mono text-sm text-white'>
											{formatDiffMs(res.best_elapsed_ms, baseTime)}
										</div>
										<div className='text-[10px] text-neutral-500'>
											{res.category_name || 'Sin categoría'}
										</div>
									</div>
								</div>

								{/* debug opcional para control interno */}
								<div className='text-[10px] text-neutral-600 font-mono mt-2'>
									bruto(ms): {res.best_elapsed_ms}
								</div>
							</li>
						))}
					</ul>
				)}
			</section>

			{/* CTA flotante futura: podio rápido */}
			<div className='fixed bottom-4 right-4 flex flex-col gap-2'>
				<button
					className='bg-blue-600 text-white font-semibold text-sm px-4 py-3 rounded-xl active:scale-95'
					onClick={() => {
						// En la siguiente iteración esto va a mostrar top 3 de la categoría seleccionada
						alert(
							'Vista Podio rápido (top 3 de la categoría seleccionada) - próximo paso'
						);
					}}
				>
					Podio rápido
				</button>
			</div>
		</main>
	);
}
