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

type CategoryRow = {
	id: number;
	name: string;
	sex_allowed: 'ANY' | 'M' | 'F' | 'X';
	age_min: number;
	age_max: number;
	distance_km: number;
	is_active: boolean;
};

export default function CategoriesPage({
	params,
}: {
	params: Promise<{ raceId: string }>;
}) {
	const { raceId: raceIdStr } = use(params);
	const raceId = Number(raceIdStr);
	const router = useRouter();

	const [race, setRace] = useState<Race | null>(null);
	const [categories, setCategories] = useState<CategoryRow[]>([]);
	const [loading, setLoading] = useState(true);

	// ----- Modal: categoría individual -----
	const [showNewModal, setShowNewModal] = useState(false);
	const [savingCat, setSavingCat] = useState(false);
	const [catErr, setCatErr] = useState('');

	const [catName, setCatName] = useState('');
	const [catSex, setCatSex] = useState<'ANY' | 'M' | 'F' | 'X'>('ANY');
	const [catDist, setCatDist] = useState('');
	const [catMinAge, setCatMinAge] = useState('');
	const [catMaxAge, setCatMaxAge] = useState('');
	const [catActive, setCatActive] = useState(true);

	// ----- Modal: carga MASIVA -----
	const [showBulkModal, setShowBulkModal] = useState(false);
	const [bulkErr, setBulkErr] = useState('');
	const [bulkSaving, setBulkSaving] = useState(false);

	const [bulkDistance, setBulkDistance] = useState('');
	const [bulkSexMode, setBulkSexMode] = useState<'SPLIT' | 'ANY'>('SPLIT');
	// SPLIT => separa Caballeros/Damas
	// ANY   => mixto

	const [bulkSexLabelStyle, setBulkSexLabelStyle] = useState<
		'COMPLETO' | 'INICIAL'
	>('COMPLETO');
	// COMPLETO => "Caballeros", "Damas", "General"
	// INICIAL  => "M", "F", "G"

	const [bulkAgeBands, setBulkAgeBands] = useState('18-29;30-39;40-49');

	// Plantilla del nombre con tokens personalizados
	// [[distancia]], [[sexo]], [[sexo_inicial]], [[edad_min]], [[edad_max]]
	const [bulkNamePattern, setBulkNamePattern] = useState(
		'[[distancia]]K [[sexo]] DE [[edad_min]] A [[edad_max]]'
	);

	// ----- Modal: borrar todas -----
	const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
	const [deleteAllErr, setDeleteAllErr] = useState('');
	const [deletingAll, setDeletingAll] = useState(false);

	// -------------------------------------------------
	// Cargar datos
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

		const { data: catData, error: catErr } = await supabase
			.from('categories')
			.select('id, name, sex_allowed, age_min, age_max, distance_km, is_active')
			.eq('race_id', raceId)
			.order('distance_km', { ascending: true })
			.order('age_min', { ascending: true });

		if (catErr) {
			console.error('Error cargando categorías:', catErr);
			setCategories([]);
		} else {
			setCategories(catData as CategoryRow[]);
		}

		setLoading(false);
	}

	useEffect(() => {
		loadData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [raceId]);

	function parseNumberOrNull(v: string): number | null {
		if (!v.trim()) return null;
		const n = Number(v.replace(',', '.'));
		if (!Number.isFinite(n)) return null;
		return n;
	}

	// -------------------------------------------------
	// Crear categoría individual
	// -------------------------------------------------

	async function handleCreateCategory() {
		if (!race) {
			setCatErr('No hay carrera cargada.');
			return;
		}

		setSavingCat(true);
		setCatErr('');

		if (!catName.trim()) {
			setCatErr('Poné un nombre para la categoría.');
			setSavingCat(false);
			return;
		}

		const distNum = parseNumberOrNull(catDist);
		if (distNum === null || distNum <= 0) {
			setCatErr('Distancia inválida.');
			setSavingCat(false);
			return;
		}

		const minAgeNum = parseInt(catMinAge, 10);
		const maxAgeNum = parseInt(catMaxAge, 10);

		if (
			!Number.isFinite(minAgeNum) ||
			!Number.isFinite(maxAgeNum) ||
			minAgeNum < 0 ||
			maxAgeNum < minAgeNum
		) {
			setCatErr('Rango de edad inválido.');
			setSavingCat(false);
			return;
		}

		const { error: insErr } = await supabase.from('categories').insert([
			{
				race_id: race.id,
				name: catName.trim(),
				sex_allowed: catSex,
				age_min: minAgeNum,
				age_max: maxAgeNum,
				distance_km: distNum,
				is_active: catActive,
			},
		]);

		if (insErr) {
			console.error('Error creando categoría:', insErr);
			setCatErr('No se pudo crear la categoría.');
			setSavingCat(false);
			return;
		}

		// limpiar modal
		setCatName('');
		setCatSex('ANY');
		setCatDist('');
		setCatMinAge('');
		setCatMaxAge('');
		setCatActive(true);
		setShowNewModal(false);
		setSavingCat(false);

		loadData();
	}

	// -------------------------------------------------
	// Helpers para el nombre masivo
	// -------------------------------------------------

	function buildSexLabelFull(sexAllowed: 'M' | 'F' | 'ANY'): string {
		if (sexAllowed === 'M') return 'Caballeros';
		if (sexAllowed === 'F') return 'Damas';
		return 'General';
	}

	function buildSexLabelInitial(sexAllowed: 'M' | 'F' | 'ANY'): string {
		if (sexAllowed === 'M') return 'M';
		if (sexAllowed === 'F') return 'F';
		return 'G';
	}

	function applyPattern(
		pattern: string,
		data: {
			distancia: number;
			sexoFull: string;
			sexoInicial: string;
			edadMin: number;
			edadMax: number;
		}
	): string {
		let name = pattern;
		name = name.replaceAll('[[distancia]]', String(data.distancia));
		name = name.replaceAll('[[sexo]]', data.sexoFull);
		name = name.replaceAll('[[sexo_inicial]]', data.sexoInicial);
		name = name.replaceAll('[[edad_min]]', String(data.edadMin));
		name = name.replaceAll('[[edad_max]]', String(data.edadMax));
		// limpieza: evitar dobles espacios
		return name.trim().replace(/\s+/g, ' ');
	}

	// -------------------------------------------------
	// Crear categorías MASIVAS
	// -------------------------------------------------

	async function handleBulkCreate() {
		if (!race) {
			setBulkErr('No hay carrera cargada.');
			return;
		}

		setBulkSaving(true);
		setBulkErr('');

		const distNum = parseNumberOrNull(bulkDistance);
		if (distNum === null || distNum <= 0) {
			setBulkErr('Distancia inválida.');
			setBulkSaving(false);
			return;
		}

		// Parseo bandas ej "18-29;30-39;40-49"
		const bandas = bulkAgeBands
			.split(';')
			.map((frag) => frag.trim())
			.filter((frag) => frag.length > 0)
			.map((frag) => {
				const m = frag.match(/^(\d+)\s*-\s*(\d+)$/);
				if (!m) return null;
				const minA = parseInt(m[1], 10);
				const maxA = parseInt(m[2], 10);
				if (
					!Number.isFinite(minA) ||
					!Number.isFinite(maxA) ||
					minA < 0 ||
					maxA < minA
				) {
					return null;
				}
				return { minA, maxA };
			});

		if (bandas.length === 0 || bandas.some((b) => b === null)) {
			setBulkErr(
				'Formato de bandas inválido. Ejemplo válido: 18-29;30-39;40-49'
			);
			setBulkSaving(false);
			return;
		}

		const inserts: any[] = [];

		for (const b of bandas) {
			if (!b) continue;
			const { minA, maxA } = b;

			if (bulkSexMode === 'SPLIT') {
				// masculino
				const sexM: 'M' = 'M';
				const sexoFullM =
					bulkSexLabelStyle === 'COMPLETO'
						? buildSexLabelFull(sexM)
						: buildSexLabelInitial(sexM);

				const nameM = applyPattern(bulkNamePattern, {
					distancia: distNum,
					sexoFull: sexoFullM,
					sexoInicial: buildSexLabelInitial(sexM),
					edadMin: minA,
					edadMax: maxA,
				});

				inserts.push({
					race_id: race.id,
					name: nameM,
					sex_allowed: 'M',
					age_min: minA,
					age_max: maxA,
					distance_km: distNum,
					is_active: true,
				});

				// femenino
				const sexF: 'F' = 'F';
				const sexoFullF =
					bulkSexLabelStyle === 'COMPLETO'
						? buildSexLabelFull(sexF)
						: buildSexLabelInitial(sexF);

				const nameF = applyPattern(bulkNamePattern, {
					distancia: distNum,
					sexoFull: sexoFullF,
					sexoInicial: buildSexLabelInitial(sexF),
					edadMin: minA,
					edadMax: maxA,
				});

				inserts.push({
					race_id: race.id,
					name: nameF,
					sex_allowed: 'F',
					age_min: minA,
					age_max: maxA,
					distance_km: distNum,
					is_active: true,
				});
			} else {
				// mixto / ANY
				const sexAny: 'ANY' = 'ANY';
				const sexoFullAny =
					bulkSexLabelStyle === 'COMPLETO'
						? buildSexLabelFull(sexAny)
						: buildSexLabelInitial(sexAny);

				const nameAny = applyPattern(bulkNamePattern, {
					distancia: distNum,
					sexoFull: sexoFullAny,
					sexoInicial: buildSexLabelInitial(sexAny),
					edadMin: minA,
					edadMax: maxA,
				});

				inserts.push({
					race_id: race.id,
					name: nameAny,
					sex_allowed: 'ANY',
					age_min: minA,
					age_max: maxA,
					distance_km: distNum,
					is_active: true,
				});
			}
		}

		if (inserts.length === 0) {
			setBulkErr('No se generaron categorías.');
			setBulkSaving(false);
			return;
		}

		const { error: bulkErrInsert } = await supabase
			.from('categories')
			.insert(inserts);

		if (bulkErrInsert) {
			console.error('Error creando categorías masivas:', bulkErrInsert);
			setBulkErr('No se pudieron crear las categorías.');
			setBulkSaving(false);
			return;
		}

		// reset modal masivo
		setBulkDistance('');
		setBulkSexMode('SPLIT');
		setBulkSexLabelStyle('COMPLETO');
		setBulkAgeBands('18-29;30-39;40-49');
		setBulkNamePattern(
			'[[distancia]]K [[sexo]] DE [[edad_min]] A [[edad_max]]'
		);

		setShowBulkModal(false);
		setBulkSaving(false);

		loadData();
	}

	// -------------------------------------------------
	// Activar / Desactivar categoría existente
	// -------------------------------------------------

	async function handleToggleActive(catId: number, current: boolean) {
		const { error: upErr } = await supabase
			.from('categories')
			.update({ is_active: !current })
			.eq('id', catId)
			.eq('race_id', raceId);

		if (upErr) {
			console.error('Error actualizando categoría:', upErr);
		}
		loadData();
	}

	// -------------------------------------------------
	// Eliminar UNA categoría
	// -------------------------------------------------

	async function handleDeleteCategory(catId: number, catNameConfirm: string) {
		// pequeña confirmación runtime
		const ok = window.confirm(
			`Vas a eliminar la categoría "${catNameConfirm}". Esto no se puede deshacer.\n` +
				`Los participantes que estaban asignados a esta categoría quedarán sin categoría.\n\n¿Continuar?`
		);
		if (!ok) return;

		const { error: delErr } = await supabase
			.from('categories')
			.delete()
			.eq('id', catId)
			.eq('race_id', raceId);

		if (delErr) {
			console.error('Error eliminando categoría:', delErr);
			// Podríamos mostrar un alert simple
			alert('No se pudo eliminar la categoría en Supabase.');
			return;
		}

		loadData();
	}

	// -------------------------------------------------
	// Eliminar TODAS las categorías de la carrera
	// -------------------------------------------------

	async function confirmDeleteAllCategories() {
		if (!race) return;
		setDeletingAll(true);
		setDeleteAllErr('');

		// delete all by race_id
		const { error: delAllErr } = await supabase
			.from('categories')
			.delete()
			.eq('race_id', raceId);

		if (delAllErr) {
			console.error('Error eliminando TODAS las categorías:', delAllErr);
			setDeleteAllErr('No se pudieron eliminar todas las categorías.');
			setDeletingAll(false);
			return;
		}

		setDeletingAll(false);
		setShowDeleteAllModal(false);

		loadData();
	}

	// -------------------------------------------------
	// Render
	// -------------------------------------------------

	if (loading && !race) {
		return (
			<main className='min-h-screen bg-neutral-950 text-white p-4'>
				<div className='text-neutral-400 text-sm'>Cargando...</div>
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
						← Volver a la carrera
					</button>
					<span className='text-neutral-600'>/</span>
					<span>Categorías</span>
				</div>

				<div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3'>
					<div>
						<h1 className='text-2xl font-bold leading-tight break-words'>
							Categorías · {race.name}
						</h1>
						<div className='text-sm text-neutral-400'>
							{race.date} · {race.location || 'Sin ubicación'}
						</div>
					</div>

					<div className='flex flex-col sm:flex-row gap-2 w-full sm:w-auto'>
						<button
							className='bg-emerald-600 text-white text-sm font-semibold px-4 py-2 rounded-lg active:scale-95 w-full sm:w-auto'
							onClick={() => {
								setCatErr('');
								setShowNewModal(true);
							}}
						>
							+ Categoría individual
						</button>

						<button
							className='bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg active:scale-95 w-full sm:w-auto'
							onClick={() => {
								setBulkErr('');
								setShowBulkModal(true);
							}}
						>
							+ Carga masiva
						</button>

						<button
							className='bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-lg active:scale-95 w-full sm:w-auto border border-red-500'
							onClick={() => {
								setDeleteAllErr('');
								setShowDeleteAllModal(true);
							}}
						>
							Borrar TODAS
						</button>
					</div>
				</div>
			</div>

			{/* LISTA DE CATEGORÍAS */}
			{categories.length === 0 ? (
				<div className='text-neutral-400 text-sm'>
					No hay categorías todavía.
				</div>
			) : (
				<ul className='flex flex-col gap-2'>
					{categories.map((c) => (
						<li
							key={c.id}
							className='border border-neutral-700 bg-neutral-900 rounded-xl p-3 text-sm flex flex-col gap-2'
						>
							<div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2'>
								<div className='flex flex-col flex-1 min-w-0'>
									<div className='font-semibold text-white leading-tight break-words'>
										{c.name}
									</div>
									<div className='text-[11px] text-neutral-400 flex flex-wrap gap-2 leading-tight mt-1'>
										<span>
											Sexo:&nbsp;
											{c.sex_allowed === 'ANY' ? 'Cualquiera' : c.sex_allowed}
										</span>
										<span>
											Edad:&nbsp;{c.age_min} - {c.age_max}
										</span>
										<span>Dist:&nbsp;{c.distance_km}K</span>
									</div>
								</div>

								<div className='flex flex-row flex-wrap items-center gap-2 shrink-0'>
									<span
										className={
											'text-[11px] px-2 py-1 rounded border ' +
											(c.is_active
												? 'bg-emerald-700/20 border-emerald-600 text-emerald-400'
												: 'bg-neutral-800 border-neutral-600 text-neutral-400')
										}
									>
										{c.is_active ? 'Activa' : 'Inactiva'}
									</span>

									<button
										className='text-[11px] bg-neutral-800 border border-neutral-600 rounded px-2 py-1 text-neutral-200 active:scale-95'
										onClick={() => handleToggleActive(c.id, c.is_active)}
									>
										{c.is_active ? 'Desactivar' : 'Activar'}
									</button>

									<button
										className='text-[11px] bg-red-800 border border-red-600 rounded px-2 py-1 text-white active:scale-95'
										onClick={() => handleDeleteCategory(c.id, c.name)}
									>
										Eliminar
									</button>
								</div>
							</div>
						</li>
					))}
				</ul>
			)}

			{/* MODAL NUEVA CATEGORÍA (individual) */}
			{showNewModal && (
				<div className='fixed inset-0 flex items-center justify-center bg-black/70 p-4 z-[60]'>
					<div className='w-full max-w-sm bg-neutral-900 border border-neutral-700 rounded-xl p-4 flex flex-col gap-4'>
						<div className='flex items-start justify-between'>
							<div className='text-lg font-semibold text-white'>
								Nueva categoría
							</div>
							<button
								className='text-neutral-400 text-sm'
								disabled={savingCat}
								onClick={() => {
									if (!savingCat) {
										setShowNewModal(false);
										setCatErr('');
									}
								}}
							>
								✕
							</button>
						</div>

						<div className='text-xs text-neutral-400 leading-snug'>
							Definí las reglas de inclusión. Cada corredor que cumpla (sexo /
							edad / distancia) cae acá automáticamente.
						</div>

						{catErr && <div className='text-red-400 text-sm'>{catErr}</div>}

						{/* Nombre */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Nombre de la categoría</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={catName}
								onChange={(e) => setCatName(e.target.value)}
								disabled={savingCat}
								placeholder='Ej: "10K Caballeros DE 40 A 49"'
							/>
						</label>

						{/* Sexo */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Sexo permitido</span>
							<select
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={catSex}
								onChange={(e) =>
									setCatSex(e.target.value as 'ANY' | 'M' | 'F' | 'X')
								}
								disabled={savingCat}
							>
								<option value='ANY'>Cualquiera</option>
								<option value='M'>M</option>
								<option value='F'>F</option>
								<option value='X'>X</option>
							</select>
						</label>

						{/* Distancia */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Distancia (km)</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={catDist}
								onChange={(e) => setCatDist(e.target.value)}
								disabled={savingCat}
								placeholder='10'
							/>
						</label>

						{/* Rango de edad */}
						<div className='grid grid-cols-2 gap-3'>
							<label className='text-sm flex flex-col gap-1'>
								<span>Edad mín.</span>
								<input
									className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
									value={catMinAge}
									onChange={(e) => setCatMinAge(e.target.value)}
									disabled={savingCat}
									placeholder='40'
								/>
							</label>

							<label className='text-sm flex flex-col gap-1'>
								<span>Edad máx.</span>
								<input
									className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
									value={catMaxAge}
									onChange={(e) => setCatMaxAge(e.target.value)}
									disabled={savingCat}
									placeholder='49'
								/>
							</label>
						</div>

						{/* Activo */}
						<label className='text-sm flex items-center gap-2'>
							<input
								type='checkbox'
								className='w-4 h-4 accent-emerald-600'
								checked={catActive}
								onChange={(e) => setCatActive(e.target.checked)}
								disabled={savingCat}
							/>
							<span className='text-neutral-200 text-xs'>Categoría activa</span>
						</label>

						<button
							className='w-full bg-emerald-600 text-white font-semibold text-base px-4 py-3 rounded-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100'
							disabled={savingCat}
							onClick={handleCreateCategory}
						>
							{savingCat ? 'Guardando...' : 'Crear categoría'}
						</button>
					</div>
				</div>
			)}

			{/* MODAL CARGA MASIVA */}
			{showBulkModal && (
				<div className='fixed inset-0 flex items-center justify-center bg-black/70 p-4 z-[70]'>
					<div className='w-full max-w-sm bg-neutral-900 border border-neutral-700 rounded-xl p-4 flex flex-col gap-4'>
						<div className='flex items-start justify-between'>
							<div className='text-lg font-semibold text-white'>
								Carga masiva de categorías
							</div>
							<button
								className='text-neutral-400 text-sm'
								disabled={bulkSaving}
								onClick={() => {
									if (!bulkSaving) {
										setShowBulkModal(false);
										setBulkErr('');
									}
								}}
							>
								✕
							</button>
						</div>

						<div className='text-xs text-neutral-400 leading-snug space-y-2'>
							<div>
								Definí distancia, cortes de edad y cómo querés nombrar cada
								categoría. Se van a generar todas juntas.
							</div>
							<div className='text-[10px] text-neutral-500 leading-tight'>
								Bandas válidas:{' '}
								<span className='font-mono'>18-29;30-39;40-49</span>
							</div>
							<div className='text-[10px] text-neutral-500 leading-tight'>
								Tokens nombre:
								<br />
								<span className='font-mono text-[10px] text-neutral-300'>
									[[distancia]] [[sexo]] [[sexo_inicial]] [[edad_min]]
									[[edad_max]]
								</span>
							</div>
							<div className='text-[10px] text-neutral-400 leading-tight'>
								Ejemplo:{' '}
								<span className='font-mono text-[10px] text-neutral-300'>
									[[distancia]]K [[sexo]] DE [[edad_min]] A [[edad_max]]
								</span>
							</div>
						</div>

						{bulkErr && <div className='text-red-400 text-sm'>{bulkErr}</div>}

						{/* Distancia */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Distancia (km)</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={bulkDistance}
								onChange={(e) => setBulkDistance(e.target.value)}
								disabled={bulkSaving}
								placeholder='10'
							/>
						</label>

						{/* Modo de sexo SPLIT / ANY */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Sexo / división</span>
							<select
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={bulkSexMode}
								onChange={(e) =>
									setBulkSexMode(e.target.value as 'SPLIT' | 'ANY')
								}
								disabled={bulkSaving}
							>
								<option value='SPLIT'>Separar Caballeros/Damas</option>
								<option value='ANY'>Mixto (General)</option>
							</select>
							<span className='text-[10px] text-neutral-500 leading-tight'>
								SPLIT → crea M y F. ANY → crea solo una categoría mixta.
							</span>
						</label>

						{/* Estilo etiqueta sexo */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Formato de sexo en el nombre</span>
							<select
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={bulkSexLabelStyle}
								onChange={(e) =>
									setBulkSexLabelStyle(e.target.value as 'COMPLETO' | 'INICIAL')
								}
								disabled={bulkSaving}
							>
								<option value='COMPLETO'>
									Nombre completo (Caballeros / Damas / General)
								</option>
								<option value='INICIAL'>Inicial (M / F / G)</option>
							</select>
							<span className='text-[10px] text-neutral-500 leading-tight'>
								Esto impacta en [[sexo]]. Siempre podés usar [[sexo_inicial]]
								directo si querés inicial fija.
							</span>
						</label>

						{/* Bandas de edad */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Bandas de edad</span>
							<textarea
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-sm min-h-[70px]'
								value={bulkAgeBands}
								onChange={(e) => setBulkAgeBands(e.target.value)}
								disabled={bulkSaving}
							/>
							<span className='text-[10px] text-neutral-500 leading-tight'>
								Formato: "18-29;30-39;40-49"
							</span>
						</label>

						{/* Plantilla de nombre */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Plantilla de nombre</span>
							<textarea
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-sm min-h-[60px]'
								value={bulkNamePattern}
								onChange={(e) => setBulkNamePattern(e.target.value)}
								disabled={bulkSaving}
							/>
							<span className='text-[10px] text-neutral-500 leading-tight'>
								Ejemplo recomendado:
								<br />
								<span className='font-mono text-[10px] text-neutral-300'>
									[[distancia]]K [[sexo]] DE [[edad_min]] A [[edad_max]]
								</span>
							</span>
						</label>

						<button
							className='w-full bg-blue-600 text-white font-semibold text-base px-4 py-3 rounded-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100'
							disabled={bulkSaving}
							onClick={handleBulkCreate}
						>
							{bulkSaving ? 'Creando...' : 'Crear categorías masivas'}
						</button>
					</div>
				</div>
			)}

			{/* MODAL BORRAR TODAS LAS CATEGORÍAS */}
			{showDeleteAllModal && (
				<div className='fixed inset-0 flex items-center justify-center bg-black/70 p-4 z-[80]'>
					<div className='w-full max-w-sm bg-neutral-900 border border-red-700 rounded-xl p-4 flex flex-col gap-4'>
						<div className='flex items-start justify-between'>
							<div className='text-lg font-semibold text-red-400'>
								Borrar TODAS las categorías
							</div>
							<button
								className='text-neutral-400 text-sm'
								disabled={deletingAll}
								onClick={() => {
									if (!deletingAll) {
										setShowDeleteAllModal(false);
										setDeleteAllErr('');
									}
								}}
							>
								✕
							</button>
						</div>

						<div className='text-xs text-neutral-300 leading-snug space-y-2'>
							<p>Esto va a ELIMINAR TODAS las categorías de esta carrera.</p>
							<p className='text-red-400 font-semibold'>
								Esta acción es destructiva. No la vas a poder deshacer.
							</p>
							<p className='text-[11px] text-neutral-400 leading-tight'>
								Los participantes quedan sin categoría hasta que vuelvas a
								generar categorías nuevas y presiones "Recalcular categorías" en
								la pantalla principal de la carrera.
							</p>
						</div>

						{deleteAllErr && (
							<div className='text-red-400 text-sm'>{deleteAllErr}</div>
						)}

						<button
							className='w-full bg-red-700 border border-red-500 text-white font-semibold text-base px-4 py-3 rounded-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100'
							disabled={deletingAll}
							onClick={confirmDeleteAllCategories}
						>
							{deletingAll ? 'Borrando...' : 'Borrar todas las categorías'}
						</button>
					</div>
				</div>
			)}
		</main>
	);
}
