'use client';

import { useEffect, useState } from 'react';

import { supabase } from '../lib/supabaseClient';
import { useRouter } from 'next/navigation';

type Race = {
	id: number;
	name: string;
	date: string | null;
	location: string | null;
	status: string | null;
};

export default function HomePage() {
	const router = useRouter();
	const [races, setRaces] = useState<Race[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedRaceId, setSelectedRaceId] = useState<number | null>(null);
	const [error, setError] = useState('');

	useEffect(() => {
		(async () => {
			setLoading(true);
			setError('');
			const { data, error } = await supabase
				.from('races')
				.select('id,name,date,location,status')
				.order('date', { ascending: false });
			if (error) {
				console.error(error);
				setError('No se pudieron cargar las carreras.');
				setRaces([]);
			} else {
				setRaces((data || []) as Race[]);
			}
			setLoading(false);
		})();
	}, []);

	function goToLookup() {
		if (!selectedRaceId) return;
		router.push(`/race/${selectedRaceId}/lookup`);
	}

	return (
		<main className='min-h-screen bg-neutral-950 text-white p-6 flex items-center justify-center'>
			<div className='w-full max-w-xl border border-neutral-800 bg-neutral-900 rounded-2xl p-6'>
				<h1 className='text-2xl font-bold'>Buscador de participantes</h1>
				<p className='text-neutral-400 text-sm mt-1'>
					Elegí la carrera para consultar inscriptos. Acceso solo lectura.
				</p>

				<div className='mt-6'>
					<label className='text-sm text-neutral-300'>Carrera</label>
					<div className='mt-2'>
						{loading ? (
							<div className='text-neutral-500 text-sm'>Cargando…</div>
						) : error ? (
							<div className='text-red-400 text-sm'>{error}</div>
						) : races.length === 0 ? (
							<div className='text-neutral-500 text-sm'>No hay carreras.</div>
						) : (
							<select
								className='w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm'
								value={selectedRaceId ?? ''}
								onChange={(e) =>
									setSelectedRaceId(
										e.target.value ? Number(e.target.value) : null
									)
								}
							>
								<option value=''>-- Elegí una carrera --</option>
								{races.map((r) => (
									<option key={r.id} value={r.id}>
										{r.name} {r.date ? `· ${r.date}` : ''}{' '}
										{r.location ? `· ${r.location}` : ''}
									</option>
								))}
							</select>
						)}
					</div>
				</div>

				<button
					className='mt-6 w-full bg-emerald-600 text-white font-semibold px-4 py-3 rounded-lg disabled:opacity-50 active:scale-95'
					disabled={!selectedRaceId}
					onClick={goToLookup}
				>
					Ir al buscador
				</button>

				<div className='mt-4 text-[11px] text-neutral-500'>
					* El resto de funcionalidades (carga, edición, cronometraje, etc.)
					quedan ocultas en la sección de administración.
				</div>
			</div>
		</main>
	);
}

