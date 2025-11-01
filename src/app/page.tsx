'use client';

import { useEffect, useState } from 'react';

import { supabase } from '../lib/supabaseClient';

type Race = {
	id: number;
	name: string;
	date: string; // string (viene de Supabase/Postgres)
	location: string | null;
	status: string;
};

export default function HomePage() {
	const [races, setRaces] = useState<Race[]>([]);
	const [loading, setLoading] = useState(true);

	// estado del modal
	const [showModal, setShowModal] = useState(false);

	// campos del form "nueva carrera"
	const [newName, setNewName] = useState('');
	const [newDate, setNewDate] = useState('');
	const [newLocation, setNewLocation] = useState('');
	const [saving, setSaving] = useState(false);
	const [errorMsg, setErrorMsg] = useState('');

	// 1. cargar carreras desde Supabase
	async function loadRaces() {
		setLoading(true);

		const { data, error } = await supabase
			.from('races')
			.select('id, name, date, location, status')
			.order('date', { ascending: false });

		if (error) {
			console.error('Error cargando carreras:', error);
			setRaces([]);
		} else {
			setRaces(data as Race[]);
		}

		setLoading(false);
	}

	useEffect(() => {
		loadRaces();
	}, []);

	// 2. guardar nueva carrera en Supabase
	async function handleCreateRace() {
		setSaving(true);
		setErrorMsg('');

		// validaciones básicas para no subir basura
		if (!newName.trim()) {
			setErrorMsg('Falta el nombre.');
			setSaving(false);
			return;
		}
		if (!newDate.trim()) {
			setErrorMsg('Falta la fecha.');
			setSaving(false);
			return;
		}

		const { error } = await supabase.from('races').insert([
			{
				name: newName.trim(),
				date: newDate.trim(), // YYYY-MM-DD
				location: newLocation.trim() || null,
				status: 'draft', // estado inicial por defecto
			},
		]);

		if (error) {
			console.error('Error guardando carrera:', error);
			setErrorMsg('No se pudo guardar. Revisar consola.');
			setSaving(false);
			return;
		}

		// si salió bien:
		//  - limpiamos el form
		//  - cerramos modal
		//  - recargamos la lista
		setNewName('');
		setNewDate('');
		setNewLocation('');
		setShowModal(false);
		setSaving(false);

		loadRaces();
	}

	return (
		<main className='min-h-screen p-4 flex flex-col gap-4 bg-neutral-950 text-white'>
			{/* HEADER */}
			<header className='flex flex-col'>
				<h1 className='text-2xl font-bold'>Carreras</h1>
				<p className='text-sm text-neutral-400'>
					Vista operativa (mobile first)
				</p>
			</header>

			{/* LISTA / ESTADOS */}
			{loading && (
				<div className='text-neutral-400 text-base'>Cargando carreras...</div>
			)}

			{!loading && races.length === 0 && (
				<div className='text-neutral-400 text-base'>
					No hay carreras creadas todavía.
				</div>
			)}

			{!loading && races.length > 0 && (
				<ul className='flex flex-col gap-3 pb-24'>
					{races.map((race) => (
						<li
							key={race.id}
							className='rounded-xl border border-neutral-700 p-4 flex flex-col bg-neutral-900 cursor-pointer active:scale-[0.99]'
							onClick={() => {
								window.location.href = `/race/${race.id}`;
							}}
						>
							<div className='text-lg font-semibold'>{race.name}</div>

							<div className='text-sm text-neutral-400'>
								{race.date} · {race.location || 'Sin ubicación'}
							</div>

							<div className='text-xs mt-2 inline-block px-2 py-1 rounded bg-neutral-800 text-neutral-300 border border-neutral-600 w-fit'>
								{race.status}
							</div>
						</li>
					))}
				</ul>
			)}

			{/* BOTÓN FLOTANTE */}
			<button
				className='fixed bottom-4 right-4 bg-emerald-600 text-white font-semibold text-base px-4 py-3 rounded-xl shadow-lg active:scale-95'
				onClick={() => setShowModal(true)}
			>
				+ Nueva carrera
			</button>

			{/* MODAL DE NUEVA CARRERA */}
			{showModal && (
				<div className='fixed inset-0 flex items-center justify-center bg-black/70 p-4 z-50'>
					<div className='w-full max-w-sm bg-neutral-900 border border-neutral-700 rounded-xl p-4 flex flex-col gap-4'>
						<div className='flex items-start justify-between'>
							<div className='text-lg font-semibold'>Nueva carrera</div>
							<button
								className='text-neutral-400 text-sm'
								onClick={() => {
									if (!saving) {
										setShowModal(false);
										setErrorMsg('');
									}
								}}
							>
								✕
							</button>
						</div>

						<label className='text-sm flex flex-col gap-1'>
							<span>Nombre</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								placeholder='Ej. 10K Costanera'
								value={newName}
								onChange={(e) => setNewName(e.target.value)}
								disabled={saving}
							/>
						</label>

						<label className='text-sm flex flex-col gap-1'>
							<span>Fecha</span>
							<input
								type='date'
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={newDate}
								onChange={(e) => setNewDate(e.target.value)}
								disabled={saving}
							/>
						</label>

						<label className='text-sm flex flex-col gap-1'>
							<span>Ubicación</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								placeholder='Ej. Santa Fe'
								value={newLocation}
								onChange={(e) => setNewLocation(e.target.value)}
								disabled={saving}
							/>
						</label>

						{errorMsg && <div className='text-red-400 text-sm'>{errorMsg}</div>}

						<button
							className='w-full bg-emerald-600 text-white font-semibold text-base px-4 py-3 rounded-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100'
							disabled={saving}
							onClick={handleCreateRace}
						>
							{saving ? 'Guardando...' : 'Guardar carrera'}
						</button>
					</div>
				</div>
			)}
		</main>
	);
}

