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

// OJO: Supabase nos devuelve participant como un array
// porque estamos haciendo un join con alias participant:participant_id(...)
// y Supabase lo trata como relación 1:N.
// Nosotros vamos a usar solo el primero de ese array.
type ArrivalParticipant = {
	id: number;
	bib_number: number | null;
	first_name: string;
	last_name: string;
	sex: string;
	distance_km: number | null;
};

type ArrivalRow = {
	id: number;
	recorded_at: string; // timestamp ISO
	participant: ArrivalParticipant[]; // array, normalmente length 1
};

export default function TimingPage({
	params,
}: {
	params: Promise<{ raceId: string }>;
}) {
	const { raceId: raceIdStr } = use(params);
	const raceId = Number(raceIdStr);
	const router = useRouter();

	const [race, setRace] = useState<Race | null>(null);

	const [bibInput, setBibInput] = useState('');
	const [saveErr, setSaveErr] = useState('');
	const [saving, setSaving] = useState(false);

	const [arrivals, setArrivals] = useState<ArrivalRow[]>([]);
	const [loading, setLoading] = useState(true);

	// -------------------------------------------------
	// Cargar carrera y llegadas
	// -------------------------------------------------
	async function loadData() {
		setLoading(true);

		// carrera
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

		// últimas llegadas (más recientes primero)
		const { data: arrData, error: arrErr } = await supabase
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
          distance_km
        )
      `
			)
			.eq('race_id', raceId)
			.order('recorded_at', { ascending: false })
			.limit(20);

		if (arrErr) {
			console.error('Error cargando llegadas:', arrErr);
			setArrivals([]);
		} else {
			// arrData acá viene con participant como [].
			// Lo tipeamos como ArrivalRow[] directamente:
			setArrivals(arrData as unknown as ArrivalRow[]);
		}

		setLoading(false);
	}

	useEffect(() => {
		loadData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [raceId]);

	// -------------------------------------------------
	// Registrar llegada
	// -------------------------------------------------
	async function handleMarkArrival() {
		if (!race) {
			setSaveErr('No hay carrera cargada.');
			return;
		}

		const bibNum = Number(bibInput.replace(',', '.'));
		if (!Number.isFinite(bibNum) || bibNum <= 0) {
			setSaveErr('Dorsal inválido.');
			return;
		}

		setSaving(true);
		setSaveErr('');

		// Buscar participante por dorsal
		const { data: partData, error: partErr } = await supabase
			.from('participants')
			.select('id, bib_number, first_name, last_name, sex, distance_km')
			.eq('race_id', race.id)
			.eq('bib_number', bibNum)
			.limit(1);

		if (partErr) {
			console.error('Error buscando corredor:', partErr);
			setSaveErr('Error buscando corredor.');
			setSaving(false);
			return;
		}

		if (!partData || partData.length === 0) {
			setSaveErr('No existe participante con ese dorsal en esta carrera.');
			setSaving(false);
			return;
		}

		const runner = partData[0];

		// Insertar llegada
		const { error: insErr } = await supabase.from('finish_times').insert([
			{
				race_id: race.id,
				participant_id: runner.id,
				// recorded_at: default now()
				// elapsed_ms: null por ahora
			},
		]);

		if (insErr) {
			console.error('Error guardando llegada:', insErr);
			setSaveErr('No se pudo registrar. ¿Ya marcaste a este dorsal?');
			setSaving(false);
			// recargamos igualmente para refrescar lista
			loadData();
			return;
		}

		// éxito
		setBibInput('');
		setSaveErr('');
		setSaving(false);

		loadData();
	}

	// -------------------------------------------------
	// Render
	// -------------------------------------------------

	if (loading && !race) {
		return (
			<main className='min-h-screen bg-neutral-950 text-white p-4'>
				<div className='text-neutral-400 text-sm'>Cargando cronometraje...</div>
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
					<span>Cronometraje</span>
				</div>

				<div className='min-w-0'>
					<h1 className='text-2xl font-bold leading-tight break-words'>
						Llegadas en vivo
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

			{/* INPUT DORSAL */}
			<div className='border border-neutral-700 bg-neutral-900 rounded-xl p-4 flex flex-col gap-3 mb-6'>
				<div className='text-neutral-300 text-sm font-semibold'>
					Marcar llegada
				</div>
				<div className='text-[11px] text-neutral-400 leading-tight'>
					Ingresá el DORSAL / PECHERA que cruza la meta y tocá Guardar.
				</div>

				{saveErr && <div className='text-red-400 text-sm'>{saveErr}</div>}

				<div className='flex items-stretch gap-2'>
					<input
						className='flex-1 text-center text-2xl font-bold rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-3 text-white tracking-wider'
						placeholder='123'
						value={bibInput}
						onChange={(e) => setBibInput(e.target.value)}
						disabled={saving}
						autoFocus
					/>
					<button
						className='bg-emerald-600 text-white font-semibold text-base px-4 py-3 rounded-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100'
						disabled={saving}
						onClick={handleMarkArrival}
					>
						{saving ? 'Guardando...' : 'Marcar llegada'}
					</button>
				</div>

				<div className='text-[10px] text-neutral-500 leading-tight'>
					Si un dorsal ya fue marcado antes, se rechaza el duplicado.
				</div>
			</div>

			{/* ÚLTIMAS LLEGADAS */}
			<div className='flex flex-col gap-2'>
				<div className='text-neutral-300 text-sm font-semibold'>
					Últimas llegadas
				</div>
				{arrivals.length === 0 ? (
					<div className='text-[12px] text-neutral-500'>
						Todavía no hay llegadas registradas.
					</div>
				) : (
					<ul className='flex flex-col gap-2'>
						{arrivals.map((a) => {
							// agarramos el primer elemento del array participant
							const runner =
								a.participant && a.participant[0] ? a.participant[0] : null;

							return (
								<li
									key={a.id}
									className='border border-neutral-700 bg-neutral-900 rounded-xl p-3 text-sm flex flex-col gap-1'
								>
									<div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2'>
										<div className='flex flex-col min-w-0'>
											<div className='text-white font-semibold leading-tight break-words'>
												#{runner?.bib_number ?? '—'} ·{' '}
												{runner
													? `${runner.first_name} ${runner.last_name}`
													: 'Desconocido'}
											</div>
											<div className='text-[11px] text-neutral-400 flex flex-wrap gap-2 leading-tight mt-1'>
												<span>Sexo: {runner?.sex ?? '?'}</span>
												<span>
													Dist:{' '}
													{runner?.distance_km != null
														? `${runner.distance_km}K`
														: '—'}
												</span>
											</div>
										</div>

										<div className='text-[11px] text-neutral-500 leading-tight text-right'>
											<div>{new Date(a.recorded_at).toLocaleTimeString()}</div>
											<div className='text-neutral-600'>
												{new Date(a.recorded_at).toLocaleDateString()}
											</div>
										</div>
									</div>
								</li>
							);
						})}
					</ul>
				)}

				<div className='text-[10px] text-neutral-600 leading-tight mt-2'>
					Se muestran las últimas 20 llegadas (la más reciente primero).
				</div>
			</div>
		</main>
	);
}
