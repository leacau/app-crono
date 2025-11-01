'use client';

import { use, useEffect, useState } from 'react';

import { supabase } from '../../../lib/supabaseClient';
import { useRouter } from 'next/navigation';

type Race = {
	id: number;
	name: string;
	date: string;
	location: string | null;
	status: string;
};

export default function RacePage({
	params,
}: {
	params: Promise<{ raceId: string }>;
}) {
	const { raceId: raceIdStr } = use(params);
	const raceId = Number(raceIdStr);
	const router = useRouter();

	const [race, setRace] = useState<Race | null>(null);
	const [loading, setLoading] = useState(true);

	const [participantsCount, setParticipantsCount] = useState<number | null>(
		null
	);
	const [categoriesCount, setCategoriesCount] = useState<number | null>(null);

	// -------------------------------------------------
	// Cargar datos de la carrera + métricas rápidas
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

		// conteo participantes
		const { data: partData, error: partErr } = await supabase
			.from('participants')
			.select('id', { count: 'exact', head: true })
			.eq('race_id', raceId);

		if (partErr) {
			console.error('Error contando participantes:', partErr);
			setParticipantsCount(null);
		} else {
			// ts-expect-error supabase devuelve count fuera de data en este modo
			setParticipantsCount(partData?.length ?? partData ?? null);
			// Nota: en modo {head:true,count:'exact'} supabase no devuelve rows,
			// pero algunas versiones de @supabase/supabase-js tipan distinto.
			// En runtime count viene separado, pero TS no lo ve.
			// Si tu TS se queja, podemos hacer otra query sin head luego.
		}

		// conteo categorías
		const { data: catData, error: catErr } = await supabase
			.from('categories')
			.select('id', { count: 'exact', head: true })
			.eq('race_id', raceId);

		if (catErr) {
			console.error('Error contando categorías:', catErr);
			setCategoriesCount(null);
		} else {
			// mismo comentario que arriba
			setCategoriesCount(catData?.length ?? catData ?? null);
		}

		setLoading(false);
	}

	useEffect(() => {
		loadData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [raceId]);

	// -------------------------------------------------
	// Render states básicos
	// -------------------------------------------------
	if (loading && !race) {
		return (
			<main className='min-h-screen bg-neutral-950 text-white p-4'>
				<div className='text-neutral-400 text-sm'>Cargando carrera...</div>
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
					Volver al inicio
				</button>
			</main>
		);
	}

	// -------------------------------------------------
	// UI principal tipo dashboard
	// -------------------------------------------------
	return (
		<main className='min-h-screen bg-neutral-950 text-white p-4 pb-24'>
			{/* HEADER PRINCIPAL */}
			<div className='flex flex-col gap-1 mb-6'>
				<div className='text-sm text-neutral-400 flex items-center gap-2 flex-wrap'>
					<button
						className='underline text-neutral-300'
						onClick={() => router.push('/')}
					>
						← Carreras
					</button>
					<span className='text-neutral-600'>/</span>
					<span>{race.name}</span>
				</div>

				<div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3'>
					<div className='min-w-0'>
						<h1 className='text-2xl font-bold leading-tight break-words'>
							{race.name}
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

					<div className='grid grid-cols-2 gap-2 w-full sm:w-auto sm:grid-cols-2'>
						<div className='border border-neutral-700 bg-neutral-900 rounded-xl px-3 py-2 flex flex-col'>
							<div className='text-[10px] text-neutral-400 leading-tight'>
								Participantes
							</div>
							<div className='text-xl font-semibold text-white leading-tight'>
								{participantsCount ?? '—'}
							</div>
						</div>

						<div className='border border-neutral-700 bg-neutral-900 rounded-xl px-3 py-2 flex flex-col'>
							<div className='text-[10px] text-neutral-400 leading-tight'>
								Categorías
							</div>
							<div className='text-xl font-semibold text-white leading-tight'>
								{categoriesCount ?? '—'}
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* BLOQUES DE ACCESO */}
			<div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
				{/* 1. Participantes */}
				<button
					className='rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-left active:scale-[0.98] flex flex-col justify-between'
					onClick={() => router.push(`/race/${raceId}/participants`)}
				>
					<div className='flex flex-col gap-1'>
						<div className='text-neutral-400 text-[11px] leading-tight'>
							Gestión de atletas
						</div>
						<div className='text-lg font-semibold text-white leading-tight'>
							Participantes
						</div>
						<div className='text-[12px] text-neutral-400 leading-snug'>
							Alta manual, edición, importación masiva desde Excel/CSV,
							dorsal/pechera y datos personales.
						</div>
					</div>
					<div className='mt-3 flex items-center text-[11px] text-neutral-500 gap-2'>
						<span className='bg-neutral-800 border border-neutral-600 rounded px-2 py-1 leading-none'>
							{participantsCount ?? '—'} cargados
						</span>
						<span className='text-neutral-600'>→</span>
					</div>
				</button>

				{/* 2. Categorías */}
				<button
					className='rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-left active:scale-[0.98] flex flex-col justify-between'
					onClick={() => router.push(`/race/${raceId}/categories`)}
				>
					<div className='flex flex-col gap-1'>
						<div className='text-neutral-400 text-[11px] leading-tight'>
							Reglas de clasificación
						</div>
						<div className='text-lg font-semibold text-white leading-tight'>
							Categorías
						</div>
						<div className='text-[12px] text-neutral-400 leading-snug'>
							Definí rango de edad, sexo permitido y distancia. Creación
							individual o masiva. Activar / desactivar / borrar.
						</div>
					</div>
					<div className='mt-3 flex items-center text-[11px] text-neutral-500 gap-2'>
						<span className='bg-neutral-800 border border-neutral-600 rounded px-2 py-1 leading-none'>
							{categoriesCount ?? '—'} definidas
						</span>
						<span className='text-neutral-600'>→</span>
					</div>
				</button>

				{/* 3. Cronometraje */}
				<button
					className='rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-left active:scale-[0.98] flex flex-col justify-between'
					onClick={() => router.push(`/race/${raceId}/timing`)}
				>
					<div className='flex flex-col gap-1'>
						<div className='text-neutral-400 text-[11px] leading-tight'>
							Toma de tiempos en vivo
						</div>
						<div className='text-lg font-semibold text-white leading-tight'>
							Cronometraje
						</div>
						<div className='text-[12px] text-neutral-400 leading-snug'>
							Ingresá el dorsal cuando crucen la meta y registrá el tiempo
							oficial. Pensado para uso en llegada.
						</div>
					</div>
					<div className='mt-3 flex items-center text-[11px] text-neutral-500 gap-2'>
						<span className='bg-neutral-800 border border-neutral-600 rounded px-2 py-1 leading-none'>
							Live
						</span>
						<span className='text-neutral-600'>→</span>
					</div>
				</button>

				{/* 4. Clasificación */}
				<button
					className='rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-left active:scale-[0.98] flex flex-col justify-between'
					onClick={() => router.push(`/race/${raceId}/results`)}
				>
					<div className='flex flex-col gap-1'>
						<div className='text-neutral-400 text-[11px] leading-tight'>
							Resultados y podios
						</div>
						<div className='text-lg font-semibold text-white leading-tight'>
							Clasificación
						</div>
						<div className='text-[12px] text-neutral-400 leading-snug'>
							Orden general y por categoría. Exportable. Base para premiación y
							comunicación oficial.
						</div>
					</div>
					<div className='mt-3 flex items-center text-[11px] text-neutral-500 gap-2'>
						<span className='bg-neutral-800 border border-neutral-600 rounded px-2 py-1 leading-none'>
							Ver ranking
						</span>
						<span className='text-neutral-600'>→</span>
					</div>
				</button>
			</div>

			{/* FOOTER ACCIONES SECUNDARIAS */}
			<div className='mt-8 text-[11px] text-neutral-500 leading-relaxed border-t border-neutral-800 pt-4'>
				<div className='mb-2 font-medium text-neutral-300 text-[12px]'>
					Flujo operativo recomendado
				</div>
				<ol className='list-decimal list-inside space-y-1'>
					<li>
						Cargá/Importá todos los participantes (Nombre, Edad/Fecha,
						Distancia, etc.).
					</li>
					<li>Definí categorías (por distancia, sexo e intervalo de edad).</li>
					<li>
						Recalculá categorías (feature que vamos a agregar: asigna cada
						corredor a su categoría activa correspondiente).
					</li>
					<li>Cronometraje en vivo: cargás dorsal cuando cruza la meta.</li>
					<li>Clasificación: usás resultados y podios para premiación.</li>
				</ol>
			</div>
		</main>
	);
}
