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

type CategoryRow = {
	id: number;
	name: string;
	distance_km: number | null;
	sex: string | null; // "M" | "F" | "X" | "ALL"
	age_min: number | null;
	age_max: number | null;
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

	// Datos carrera
	const [race, setRace] = useState<Race | null>(null);

	// Lista categorías ya existentes en esa carrera
	const [categories, setCategories] = useState<CategoryRow[]>([]);
	const [loading, setLoading] = useState(true);

	// ----------------------------
	// CREAR CATEGORÍA INDIVIDUAL
	// ----------------------------
	const [showNewModal, setShowNewModal] = useState(false);
	const [savingNew, setSavingNew] = useState(false);
	const [newErr, setNewErr] = useState('');

	const [newDist, setNewDist] = useState('10'); // km
	const [newSex, setNewSex] = useState<'M' | 'F' | 'X' | 'ALL'>('M');
	const [newAgeMin, setNewAgeMin] = useState('30');
	const [newAgeMax, setNewAgeMax] = useState('39');
	const [newIsActive, setNewIsActive] = useState(true);

	// Plantilla de nombre dinámico
	const [nameTemplate, setNameTemplate] = useState(
		'[[distancia]] [[sexo]] DE [[edad_min]] A [[edad_max]]'
	);

	// Cómo mostrar el sexo en el nombre
	const [sexLabelMode, setSexLabelMode] = useState<'inicial' | 'completo'>(
		'inicial'
	);

	// ----------------------------
	// CREAR CATEGORÍAS MASIVAS
	// ----------------------------
	const [showBulkModal, setShowBulkModal] = useState(false);
	const [savingBulk, setSavingBulk] = useState(false);
	const [bulkErr, setBulkErr] = useState('');

	const [bulkDistances, setBulkDistances] = useState('5,10');
	const [bulkAgeGroups, setBulkAgeGroups] = useState('18-29\n30-39\n40-99');

	const [bulkSexM, setBulkSexM] = useState(true);
	const [bulkSexF, setBulkSexF] = useState(true);
	const [bulkSexX, setBulkSexX] = useState(false);
	const [bulkSexAll, setBulkSexAll] = useState(false);

	const [bulkTemplate, setBulkTemplate] = useState(
		'[[distancia]] [[sexo]] DE [[edad_min]] A [[edad_max]]'
	);
	const [bulkSexLabelMode, setBulkSexLabelMode] = useState<
		'inicial' | 'completo'
	>('inicial');

	const [bulkActive, setBulkActive] = useState(true);

	// -------------------------------------------------
	// Utilidades
	// -------------------------------------------------

	function sexToLabel(sexCode: string, mode: 'inicial' | 'completo'): string {
		if (mode === 'inicial') {
			return sexCode;
		}
		switch (sexCode) {
			case 'M':
				return 'MASCULINO';
			case 'F':
				return 'FEMENINO';
			case 'X':
				return 'NO BINARIO';
			case 'ALL':
				return 'GENERAL';
			default:
				return sexCode;
		}
	}

	function buildCategoryName(
		template: string,
		distKm: string | number | null,
		sexCode: string,
		ageMin: string | number | null,
		ageMax: string | number | null,
		mode: 'inicial' | 'completo'
	) {
		const cleanDist =
			distKm === null || distKm === '' ? '' : String(distKm).trim();
		const cleanSex = sexToLabel(sexCode, mode);
		const cleanMin =
			ageMin === null || ageMin === '' ? '' : String(ageMin).trim();
		const cleanMax =
			ageMax === null || ageMax === '' ? '' : String(ageMax).trim();

		return template
			.replaceAll('[[distancia]]', cleanDist)
			.replaceAll('[[sexo]]', cleanSex)
			.replaceAll('[[edad_min]]', cleanMin)
			.replaceAll('[[edad_max]]', cleanMax)
			.trim();
	}

	function parseNumberOrNull(v: string): number | null {
		if (!v || !v.trim()) return null;
		const n = Number(v.replace(',', '.'));
		if (!Number.isFinite(n)) return null;
		return n;
	}

	// -------------------------------------------------
	// Carga inicial
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

		// categorías actuales
		const { data: catData, error: catErr } = await supabase
			.from('categories')
			.select('id, name, distance_km, sex, age_min, age_max, is_active')
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

	// -------------------------------------------------
	// Crear categoría individual
	// -------------------------------------------------

	async function handleCreateCategory() {
		if (!race) {
			setNewErr('No hay carrera cargada.');
			return;
		}

		setSavingNew(true);
		setNewErr('');

		const distNum = parseNumberOrNull(newDist);
		if (distNum === null || distNum <= 0) {
			setNewErr('Distancia inválida.');
			setSavingNew(false);
			return;
		}

		const minNum = parseNumberOrNull(newAgeMin);
		const maxNum = parseNumberOrNull(newAgeMax);

		if (
			minNum === null ||
			maxNum === null ||
			minNum < 0 ||
			maxNum < 0 ||
			maxNum < minNum
		) {
			setNewErr('Rango de edad inválido.');
			setSavingNew(false);
			return;
		}

		if (!newSex) {
			setNewErr('Seleccioná un sexo.');
			setSavingNew(false);
			return;
		}

		const finalName = buildCategoryName(
			nameTemplate,
			distNum,
			newSex,
			minNum,
			maxNum,
			sexLabelMode
		);

		if (!finalName.trim()) {
			setNewErr('El nombre resultante quedó vacío. Revisá la plantilla.');
			setSavingNew(false);
			return;
		}

		const { error: insErr } = await supabase.from('categories').insert([
			{
				race_id: race.id,
				name: finalName,
				distance_km: distNum,
				sex: newSex, // 🔁 acá usamos "sex", no "sex_filter"
				age_min: minNum,
				age_max: maxNum,
				is_active: newIsActive,
			},
		]);

		if (insErr) {
			console.error('Error creando categoría:', insErr);
			setNewErr('No se pudo crear la categoría (posible duplicado).');
			setSavingNew(false);
			return;
		}

		setSavingNew(false);
		setShowNewModal(false);
		setNewErr('');

		loadData();
	}

	// -------------------------------------------------
	// Crear categorías masivas (con filtro de duplicados)
	// -------------------------------------------------

	async function handleBulkCreate() {
		if (!race) {
			setBulkErr('No hay carrera cargada.');
			return;
		}

		setSavingBulk(true);
		setBulkErr('');

		// Distancias "5,10,21"
		const dists = bulkDistances
			.split(',')
			.map((d) => d.trim())
			.filter((d) => d.length > 0);

		// Rangos "16-20" / "21-35" (uno por línea)
		const ageGroups = bulkAgeGroups
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0);

		// Sexos activos
		const chosenSexes: string[] = [];
		if (bulkSexM) chosenSexes.push('M');
		if (bulkSexF) chosenSexes.push('F');
		if (bulkSexX) chosenSexes.push('X');
		if (bulkSexAll) chosenSexes.push('ALL');

		if (dists.length === 0) {
			setBulkErr('Ingresá al menos una distancia.');
			setSavingBulk(false);
			return;
		}
		if (ageGroups.length === 0) {
			setBulkErr('Ingresá al menos un rango de edad.');
			setSavingBulk(false);
			return;
		}
		if (chosenSexes.length === 0) {
			setBulkErr('Seleccioná al menos un sexo.');
			setSavingBulk(false);
			return;
		}

		// Armar combinaciones candidatas
		const candidateRows: {
			race_id: number;
			name: string;
			distance_km: number;
			sex: string;
			age_min: number;
			age_max: number;
			is_active: boolean;
		}[] = [];

		for (const distStr of dists) {
			const distNum = parseNumberOrNull(distStr);
			if (distNum === null || distNum <= 0) {
				setBulkErr(`Distancia inválida: ${distStr}`);
				setSavingBulk(false);
				return;
			}

			for (const grp of ageGroups) {
				// ej "16-20"
				const m = grp.match(/^(\d+)\s*[-]\s*(\d+)$/);
				if (!m) {
					setBulkErr(`Rango de edad inválido: "${grp}". Usá formato 18-29`);
					setSavingBulk(false);
					return;
				}
				const gMin = Number(m[1]);
				const gMax = Number(m[2]);
				if (!Number.isFinite(gMin) || !Number.isFinite(gMax) || gMax < gMin) {
					setBulkErr(`Rango inválido: ${grp}`);
					setSavingBulk(false);
					return;
				}

				for (const sexCode of chosenSexes) {
					const catName = buildCategoryName(
						bulkTemplate,
						distNum,
						sexCode,
						gMin,
						gMax,
						bulkSexLabelMode
					);

					if (!catName.trim()) {
						setBulkErr(
							`El nombre quedó vacío para ${distNum} / ${sexCode} / ${gMin}-${gMax}`
						);
						setSavingBulk(false);
						return;
					}

					candidateRows.push({
						race_id: race.id,
						name: catName,
						distance_km: distNum,
						sex: sexCode, // 🔁 usamos "sex" acá también
						age_min: gMin,
						age_max: gMax,
						is_active: bulkActive,
					});
				}
			}
		}

		if (candidateRows.length === 0) {
			setBulkErr('No se generó ninguna categoría candidata.');
			setSavingBulk(false);
			return;
		}

		// Evitar duplicados internos + duplicados contra lo que YA existe
		// Clave única lógica: distance_km + sex + age_min + age_max
		const seenKeys = new Set<string>();

		function makeKey(
			distance_km: number,
			sex: string | null,
			age_min: number | null,
			age_max: number | null
		) {
			return `${distance_km}__${sex ?? ''}__${age_min ?? ''}__${age_max ?? ''}`;
		}

		// metemos lo que ya existe en carrera
		for (const c of categories) {
			if (
				c.distance_km != null &&
				c.sex != null &&
				c.age_min != null &&
				c.age_max != null
			) {
				const k = makeKey(c.distance_km, c.sex, c.age_min, c.age_max);
				seenKeys.add(k);
			}
		}

		// filtramos
		const rowsToInsert: typeof candidateRows = [];
		for (const row of candidateRows) {
			const k = makeKey(row.distance_km, row.sex, row.age_min, row.age_max);
			if (seenKeys.has(k)) {
				// ya existe en DB o ya lo agregamos en esta misma tanda
				continue;
			}
			seenKeys.add(k);
			rowsToInsert.push(row);
		}

		if (rowsToInsert.length === 0) {
			setBulkErr(
				'Todas las combinaciones que intentaste crear ya existen en esta carrera.'
			);
			setSavingBulk(false);
			return;
		}

		// Insert masivo sólo con las nuevas de verdad
		const { error: bulkErrRes } = await supabase
			.from('categories')
			.insert(rowsToInsert);

		if (bulkErrRes) {
			console.error('Error creando categorías masivas:', bulkErrRes);
			setBulkErr(
				'No se pudieron crear las categorías masivas. Revisá distancias / rangos / sexos.'
			);
			setSavingBulk(false);
			return;
		}

		setSavingBulk(false);
		setShowBulkModal(false);
		setBulkErr('');

		loadData();
	}

	// -------------------------------------------------
	// Toggle activar/desactivar categoría
	// -------------------------------------------------

	async function toggleActive(cat: CategoryRow) {
		const { error: upErr } = await supabase
			.from('categories')
			.update({ is_active: !cat.is_active })
			.eq('id', cat.id)
			.eq('race_id', raceId);

		if (upErr) {
			console.error('Error cambiando estado de categoría:', upErr);
		}
		loadData();
	}

	// -------------------------------------------------
	// Borrar UNA categoría
	// -------------------------------------------------

	async function deleteOneCategory(catId: number) {
		const { error: delErr } = await supabase
			.from('categories')
			.delete()
			.eq('id', catId)
			.eq('race_id', raceId);

		if (delErr) {
			console.error('Error borrando categoría:', delErr);
		}
		loadData();
	}

	// -------------------------------------------------
	// Borrar TODAS las categorías de la carrera
	// -------------------------------------------------

	async function deleteAllCategories() {
		const { error: delErrAll } = await supabase
			.from('categories')
			.delete()
			.eq('race_id', raceId);

		if (delErrAll) {
			console.error('Error borrando TODAS las categorías:', delErrAll);
		}
		loadData();
	}

	// -------------------------------------------------
	// Render
	// -------------------------------------------------

	if (loading && !race) {
		return (
			<main className='min-h-screen bg-neutral-950 text-white p-4'>
				<div className='text-neutral-400 text-sm'>Cargando categorías...</div>
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

	const previewSingleName = buildCategoryName(
		nameTemplate,
		newDist,
		newSex,
		newAgeMin,
		newAgeMax,
		sexLabelMode
	);

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
					<span>Categorías</span>
				</div>

				<div className='min-w-0'>
					<h1 className='text-2xl font-bold leading-tight break-words'>
						Categorías de carrera
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

			{/* ACCIONES RÁPIDAS */}
			<div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6'>
				<div className='flex flex-col gap-2 text-[11px] text-neutral-500 leading-tight'>
					<div>
						Definí las reglas de premiación: Distancia / Sexo / Rango de edad.
					</div>
					<div>
						Solo las categorías ACTIVAS se usan para asignar corredores.
					</div>
				</div>

				<div className='flex flex-col sm:flex-row gap-2 w-full sm:w-auto'>
					<button
						className='bg-emerald-600 text-white text-sm font-semibold px-4 py-2 rounded-lg active:scale-95 w-full sm:w-auto'
						onClick={() => {
							setNewErr('');
							setShowNewModal(true);
						}}
					>
						+ Categoría
					</button>

					<button
						className='bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg active:scale-95 w-full sm:w-auto'
						onClick={() => {
							setBulkErr('');
							setShowBulkModal(true);
						}}
					>
						+ Masivo
					</button>

					<button
						className='bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-lg active:scale-95 w-full sm:w-auto'
						onClick={deleteAllCategories}
					>
						Borrar todas
					</button>
				</div>
			</div>

			{/* LISTA DE CATEGORÍAS */}
			{categories.length === 0 ? (
				<div className='text-neutral-400 text-sm'>
					Aún no hay categorías creadas en esta carrera.
				</div>
			) : (
				<ul className='flex flex-col gap-2'>
					{categories.map((c) => (
						<li
							key={c.id}
							className='border border-neutral-700 bg-neutral-900 rounded-xl p-3 text-sm flex flex-col gap-2'
						>
							<div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2'>
								<div className='flex flex-col min-w-0'>
									<div className='flex items-center gap-2 flex-wrap'>
										<div className='text-white font-semibold leading-tight break-words'>
											{c.name}
										</div>
										<div
											className={`text-[10px] px-2 py-[2px] rounded border leading-tight ${
												c.is_active
													? 'bg-emerald-900/20 border-emerald-600 text-emerald-400'
													: 'bg-neutral-800 border-neutral-600 text-neutral-400'
											}`}
										>
											{c.is_active ? 'ACTIVA' : 'INACTIVA'}
										</div>
									</div>

									<div className='text-[11px] text-neutral-400 flex flex-wrap gap-2 leading-tight mt-1'>
										<span>
											Dist: {c.distance_km != null ? `${c.distance_km}K` : '—'}
										</span>
										<span>Sexo: {c.sex || '—'}</span>
										<span>
											Edad:{' '}
											{c.age_min != null && c.age_max != null
												? `${c.age_min} a ${c.age_max}`
												: '—'}
										</span>
									</div>
								</div>

								<div className='flex flex-row flex-wrap items-center gap-2 shrink-0'>
									<button
										className='text-[11px] bg-neutral-800 border border-neutral-600 rounded px-2 py-1 text-neutral-200 active:scale-95'
										onClick={() => toggleActive(c)}
									>
										{c.is_active ? 'Desactivar' : 'Activar'}
									</button>

									<button
										className='text-[11px] bg-red-800 border border-red-600 rounded px-2 py-1 text-white active:scale-95'
										onClick={() => deleteOneCategory(c.id)}
									>
										Borrar
									</button>
								</div>
							</div>
						</li>
					))}
				</ul>
			)}

			{/* MODAL NUEVA CATEGORÍA */}
			{showNewModal && (
				<div className='fixed inset-0 flex items-center justify-center bg-black/70 p-4 z-[100]'>
					<div className='w-full max-w-sm bg-neutral-900 border border-neutral-700 rounded-xl p-4 flex flex-col gap-4 max-h-[90vh] overflow-y-auto'>
						<div className='flex items-start justify-between'>
							<div className='text-lg font-semibold text-white'>
								Nueva categoría
							</div>
							<button
								className='text-neutral-400 text-sm'
								disabled={savingNew}
								onClick={() => {
									if (!savingNew) {
										setShowNewModal(false);
										setNewErr('');
									}
								}}
							>
								✕
							</button>
						</div>

						{newErr && <div className='text-red-400 text-sm'>{newErr}</div>}

						<div className='text-[11px] text-neutral-400 leading-tight'>
							Definí las reglas y generamos el nombre automáticamente.
						</div>

						{/* Distancia */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Distancia (km) *</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={newDist}
								onChange={(e) => setNewDist(e.target.value)}
								disabled={savingNew}
								placeholder='10'
							/>
						</label>

						{/* Sexo */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Sexo *</span>
							<select
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={newSex}
								onChange={(e) =>
									setNewSex(e.target.value as 'M' | 'F' | 'X' | 'ALL')
								}
								disabled={savingNew}
							>
								<option value='M'>M (Masculino)</option>
								<option value='F'>F (Femenino)</option>
								<option value='X'>X (No Binario)</option>
								<option value='ALL'>ALL (General)</option>
							</select>
						</label>

						{/* Rango de edad */}
						<div className='grid grid-cols-2 gap-3'>
							<label className='text-sm flex flex-col gap-1'>
								<span>Edad mínima *</span>
								<input
									className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
									value={newAgeMin}
									onChange={(e) => setNewAgeMin(e.target.value)}
									disabled={savingNew}
									placeholder='30'
								/>
							</label>

							<label className='text-sm flex flex-col gap-1'>
								<span>Edad máxima *</span>
								<input
									className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
									value={newAgeMax}
									onChange={(e) => setNewAgeMax(e.target.value)}
									disabled={savingNew}
									placeholder='39'
								/>
							</label>
						</div>

						{/* Activa */}
						<label className='text-sm flex items-center gap-2'>
							<input
								type='checkbox'
								className='w-4 h-4 accent-emerald-600'
								checked={newIsActive}
								onChange={(e) => setNewIsActive(e.target.checked)}
								disabled={savingNew}
							/>
							<span className='text-white text-[13px]'>
								Categoría activa (participa en clasificación)
							</span>
						</label>

						{/* Config nombre */}
						<div className='border border-neutral-700 rounded-lg p-3 bg-neutral-800/30 flex flex-col gap-3'>
							<div className='text-white text-sm font-semibold'>
								Nombre automático
							</div>
							<div className='text-[11px] text-neutral-400 leading-tight'>
								Podés usar:
								<br />
								[[distancia]] [[sexo]] [[edad_min]] [[edad_max]]
							</div>

							<label className='text-sm flex flex-col gap-1'>
								<span>Plantilla</span>
								<input
									className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-[13px]'
									value={nameTemplate}
									onChange={(e) => setNameTemplate(e.target.value)}
									disabled={savingNew}
								/>
							</label>

							<label className='text-sm flex flex-col gap-1'>
								<span>Sexo en el nombre</span>
								<select
									className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-[13px]'
									value={sexLabelMode}
									onChange={(e) =>
										setSexLabelMode(e.target.value as 'inicial' | 'completo')
									}
									disabled={savingNew}
								>
									<option value='inicial'>Inicial (M / F / X / ALL)</option>
									<option value='completo'>
										Completo (MASCULINO / FEMENINO / NO BINARIO / GENERAL)
									</option>
								</select>
							</label>

							<div className='text-[11px] text-neutral-400 leading-tight'>
								Vista previa:
							</div>
							<div className='text-white text-[13px] font-semibold bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2 break-words'>
								{previewSingleName || '—'}
							</div>
						</div>

						<button
							className='w-full bg-emerald-600 text-white font-semibold text-base px-4 py-3 rounded-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100'
							disabled={savingNew}
							onClick={handleCreateCategory}
						>
							{savingNew ? 'Guardando...' : 'Crear categoría'}
						</button>
					</div>
				</div>
			)}

			{/* MODAL MASIVO */}
			{showBulkModal && (
				<div className='fixed inset-0 flex items-center justify-center bg-black/70 p-4 z-[110]'>
					<div className='w-full max-w-sm bg-neutral-900 border border-neutral-700 rounded-xl p-4 flex flex-col gap-4 max-h-[90vh] overflow-y-auto'>
						<div className='flex items-start justify-between'>
							<div className='text-lg font-semibold text-white'>
								Creación masiva
							</div>
							<button
								className='text-neutral-400 text-sm'
								disabled={savingBulk}
								onClick={() => {
									if (!savingBulk) {
										setShowBulkModal(false);
										setBulkErr('');
									}
								}}
							>
								✕
							</button>
						</div>

						{bulkErr && <div className='text-red-400 text-sm'>{bulkErr}</div>}

						<div className='text-[11px] text-neutral-400 leading-tight'>
							Genera múltiples categorías combinando distancias, sexos y rangos
							de edad.
						</div>

						{/* Distancias */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Distancias (km) separadas por coma *</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-[13px]'
								value={bulkDistances}
								onChange={(e) => setBulkDistances(e.target.value)}
								disabled={savingBulk}
								placeholder='5,10,21'
							/>
							<div className='text-[10px] text-neutral-500 leading-tight'>
								Ej: 5,10,21
							</div>
						</label>

						{/* Rangos edad */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Rangos de edad (uno por línea) *</span>
							<textarea
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-[13px] min-h-[80px]'
								value={bulkAgeGroups}
								onChange={(e) => setBulkAgeGroups(e.target.value)}
								disabled={savingBulk}
								placeholder={
									'16-20\n21-35\n36-40\n41-50\n51-55\n56-60\n61-65\n66-99'
								}
							/>
							<div className='text-[10px] text-neutral-500 leading-tight'>
								Formato min-max. Ej: 18-29
							</div>
						</label>

						{/* Sexos */}
						<div className='text-sm flex flex-col gap-2'>
							<span>Sexos a generar *</span>
							<div className='grid grid-cols-2 gap-2 text-white text-[13px]'>
								<label className='flex items-center gap-2'>
									<input
										type='checkbox'
										className='w-4 h-4 accent-emerald-600'
										checked={bulkSexM}
										onChange={(e) => setBulkSexM(e.target.checked)}
										disabled={savingBulk}
									/>
									<span>M</span>
								</label>

								<label className='flex items-center gap-2'>
									<input
										type='checkbox'
										className='w-4 h-4 accent-emerald-600'
										checked={bulkSexF}
										onChange={(e) => setBulkSexF(e.target.checked)}
										disabled={savingBulk}
									/>
									<span>F</span>
								</label>

								<label className='flex items-center gap-2'>
									<input
										type='checkbox'
										className='w-4 h-4 accent-emerald-600'
										checked={bulkSexX}
										onChange={(e) => setBulkSexX(e.target.checked)}
										disabled={savingBulk}
									/>
									<span>X</span>
								</label>

								<label className='flex items-center gap-2'>
									<input
										type='checkbox'
										className='w-4 h-4 accent-emerald-600'
										checked={bulkSexAll}
										onChange={(e) => setBulkSexAll(e.target.checked)}
										disabled={savingBulk}
									/>
									<span>ALL</span>
								</label>
							</div>
						</div>

						{/* Activas */}
						<label className='text-sm flex items-center gap-2'>
							<input
								type='checkbox'
								className='w-4 h-4 accent-emerald-600'
								checked={bulkActive}
								onChange={(e) => setBulkActive(e.target.checked)}
								disabled={savingBulk}
							/>
							<span className='text-white text-[13px]'>
								Crear todas como ACTIVAS
							</span>
						</label>

						{/* Config nombre masivo */}
						<div className='border border-neutral-700 rounded-lg p-3 bg-neutral-800/30 flex flex-col gap-3'>
							<div className='text-white text-sm font-semibold'>
								Nombre automático
							</div>
							<div className='text-[11px] text-neutral-400 leading-tight'>
								Usamos esta misma plantilla para TODAS las categorías generadas.
								<br />
								Placeholders:
								<br />
								[[distancia]] [[sexo]] [[edad_min]] [[edad_max]]
							</div>

							<label className='text-sm flex flex-col gap-1'>
								<span>Plantilla masiva</span>
								<input
									className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-[13px]'
									value={bulkTemplate}
									onChange={(e) => setBulkTemplate(e.target.value)}
									disabled={savingBulk}
								/>
							</label>

							<label className='text-sm flex flex-col gap-1'>
								<span>Sexo en el nombre</span>
								<select
									className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-[13px]'
									value={bulkSexLabelMode}
									onChange={(e) =>
										setBulkSexLabelMode(
											e.target.value as 'inicial' | 'completo'
										)
									}
									disabled={savingBulk}
								>
									<option value='inicial'>Inicial (M / F / X / ALL)</option>
									<option value='completo'>
										Completo (MASCULINO / FEMENINO / NO BINARIO / GENERAL)
									</option>
								</select>
							</label>
						</div>

						<button
							className='w-full bg-blue-600 text-white font-semibold text-base px-4 py-3 rounded-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100'
							disabled={savingBulk}
							onClick={handleBulkCreate}
						>
							{savingBulk ? 'Generando...' : 'Crear categorías masivas'}
						</button>
					</div>
				</div>
			)}

			{/* NOTA FINAL */}
			<div className='mt-8 text-[11px] text-neutral-500 leading-relaxed border-t border-neutral-800 pt-4'>
				<div className='mb-2 font-medium text-neutral-300 text-[12px]'>
					Roadmap siguiente:
				</div>
				<ol className='list-decimal list-inside space-y-1'>
					<li>
						Botón “Recalcular categorías” en Participantes → asignar cada
						corredor automáticamente según distancia / sexo / edad y SOLO usando
						categorías activas.
					</li>
					<li>Podios rápidos / clasificación filtrada por categoría.</li>
				</ol>
			</div>
		</main>
	);
}
