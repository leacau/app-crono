'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';

// Tipo de carrera
type Race = {
	id: number;
	name: string;
	date: string | null;
	location: string | null;
	status: string | null;
};

// Tipo de categoría (alineado con la BD ya corregida)
type CategoryRow = {
	id: number;
	race_id: number;
	name: string;
	distance_km: number | null;
	sex_filter: string; // M / F / X / ALL
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

	// carrera actual
	const [race, setRace] = useState<Race | null>(null);

	// listado de categorías
	const [categories, setCategories] = useState<CategoryRow[]>([]);
	const [loading, setLoading] = useState(true);

	// errores
	const [loadErr, setLoadErr] = useState('');

	// form crear/editar simple
	const [showModal, setShowModal] = useState(false);
	const [editMode, setEditMode] = useState<'new' | 'edit'>('new');

	const [editId, setEditId] = useState<number | null>(null);
	const [formName, setFormName] = useState('');
	const [formDistance, setFormDistance] = useState('');
	const [formSexFilter, setFormSexFilter] = useState('ALL'); // NOTA: sex_filter
	const [formAgeMin, setFormAgeMin] = useState('');
	const [formAgeMax, setFormAgeMax] = useState('');
	const [formActive, setFormActive] = useState(true);

	const [formErr, setFormErr] = useState('');
	const [saving, setSaving] = useState(false);

	// Bulk generator (creación masiva)
	const [showBulk, setShowBulk] = useState(false);
	const [bulkDistances, setBulkDistances] = useState('');
	const [bulkRanges, setBulkRanges] = useState(
		'16-20\n21-35\n36-40\n41-50\n51-55\n56-60\n61-65\n66-99'
	);
	const [bulkSexes, setBulkSexes] = useState('M\nF\nX\nALL');
	const [bulkActive, setBulkActive] = useState(true);

	const [useAutoName, setUseAutoName] = useState(true);
	const [nameTemplate, setNameTemplate] = useState(
		`[[distancia]]K [[sexo]] DE [[edad_min]] A [[edad_max]]`
	);
	const [sexoEnNombre, setSexoEnNombre] = useState(true); // para decidir FULL ("Femenino") vs sigla ("F")

	const [bulkErr, setBulkErr] = useState('');
	const [bulkSaving, setBulkSaving] = useState(false);

	// -------------------------------------------------------
	// loadData: trae carrera + categorías
	// -------------------------------------------------------
	async function loadData() {
		setLoading(true);
		setLoadErr('');

		// carrera
		const { data: rdata, error: rerr } = await supabase
			.from('races')
			.select('id,name,date,location,status')
			.eq('id', raceId)
			.single();

		if (rerr) {
			console.error(rerr);
			setRace(null);
		} else {
			setRace(rdata as Race);
		}

		// categorías
		// OJO: ahora pedimos sex_filter, NO sex
		const { data: cdata, error: cerr } = await supabase
			.from('categories')
			.select(
				`
        id,
        race_id,
        name,
        distance_km,
        sex_filter,
        age_min,
        age_max,
        is_active
      `
			)
			.eq('race_id', raceId)
			.order('distance_km', { ascending: true })
			.order('age_min', { ascending: true });

		if (cerr) {
			console.error('Error cargando categorías:', cerr);
			setLoadErr(cerr.message || 'Error al cargar categorías (ver consola).');
			setCategories([]);
		} else {
			setCategories((cdata || []) as CategoryRow[]);
		}

		// limpiar formularios
		resetForm();
		resetBulk();
		setLoading(false);
	}

	useEffect(() => {
		loadData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [raceId]);

	// -------------------------------------------------------
	// helpers UI
	// -------------------------------------------------------

	function resetForm() {
		setShowModal(false);
		setEditMode('new');
		setEditId(null);
		setFormName('');
		setFormDistance('');
		setFormSexFilter('ALL'); // sex_filter por default
		setFormAgeMin('');
		setFormAgeMax('');
		setFormActive(true);
		setFormErr('');
		setSaving(false);
	}

	function resetBulk() {
		setShowBulk(false);
		setBulkDistances('');
		setBulkRanges('16-20\n21-35\n36-40\n41-50\n51-55\n56-60\n61-65\n66-99');
		setBulkSexes('M\nF\nX\nALL');
		setBulkActive(true);
		setUseAutoName(true);
		setNameTemplate(`[[distancia]]K [[sexo]] DE [[edad_min]] A [[edad_max]]`);
		setSexoEnNombre(true);
		setBulkErr('');
		setBulkSaving(false);
	}

	function openNew() {
		resetForm();
		setEditMode('new');
		setShowModal(true);
	}

	function openEdit(cat: CategoryRow) {
		resetForm();
		setEditMode('edit');
		setEditId(cat.id);

		setFormName(cat.name || '');
		setFormDistance(cat.distance_km != null ? String(cat.distance_km) : '');
		setFormSexFilter(cat.sex_filter || 'ALL');
		setFormAgeMin(cat.age_min != null ? String(cat.age_min) : '');
		setFormAgeMax(cat.age_max != null ? String(cat.age_max) : '');
		setFormActive(!!cat.is_active);

		setShowModal(true);
	}

	// -------------------------------------------------------
	// Guardar categoría individual (new / edit)
	// -------------------------------------------------------
	async function handleSave() {
		if (!race) return;
		setSaving(true);
		setFormErr('');

		// validaciones básicas
		const distNum = formDistance
			? Number(String(formDistance).replace(',', '.'))
			: null;
		if (!Number.isFinite(distNum)) {
			setFormErr('Distancia inválida.');
			setSaving(false);
			return;
		}

		const amin = formAgeMin ? Number(formAgeMin) : null;
		const amax = formAgeMax ? Number(formAgeMax) : null;

		if (
			amin != null &&
			amax != null &&
			Number.isFinite(amin) &&
			Number.isFinite(amax) &&
			amin > amax
		) {
			setFormErr('Edad mínima mayor que edad máxima.');
			setSaving(false);
			return;
		}

		if (!formSexFilter) {
			setFormErr('Sexo requerido (M / F / X / ALL).');
			setSaving(false);
			return;
		}

		if (!formName.trim()) {
			setFormErr('El nombre de la categoría es obligatorio.');
			setSaving(false);
			return;
		}

		// Objeto que matchea TU BD:
		const row: any = {
			race_id: race.id,
			name: formName.trim(),
			distance_km: distNum,
			sex_filter: formSexFilter, // <-- IMPORTANTE
			age_min: amin,
			age_max: amax,
			is_active: formActive,
		};

		let errorSave = null;
		if (editMode === 'new') {
			const { error } = await supabase.from('categories').insert([row]);
			errorSave = error || null;
		} else {
			const { error } = await supabase
				.from('categories')
				.update(row)
				.eq('id', editId)
				.eq('race_id', race.id);
			errorSave = error || null;
		}

		if (errorSave) {
			console.error('Error guardando categoría:', errorSave);
			setFormErr(errorSave.message || 'No se pudo guardar la categoría.');
			setSaving(false);
			return;
		}

		// recargar
		await loadData();
		setShowModal(false);
		setSaving(false);
	}

	// -------------------------------------------------------
	// Borrar categoría (1 sola)
	// -------------------------------------------------------
	async function handleDeleteOne(cat: CategoryRow) {
		if (!race) return;
		const ok = window.confirm(
			`Vas a borrar "${cat.name}" (dist ${cat.distance_km} km, ${cat.sex_filter}). ¿Confirmás?`
		);
		if (!ok) return;

		const { error } = await supabase
			.from('categories')
			.delete()
			.eq('id', cat.id)
			.eq('race_id', race.id);

		if (error) {
			console.error('Error borrando categoría:', error);
			alert('No se pudo borrar la categoría.');
			return;
		}

		loadData();
	}

	// -------------------------------------------------------
	// Borrar TODAS las categorías de la carrera
	// -------------------------------------------------------
	async function handleDeleteAll() {
		if (!race) return;
		const ok = window.confirm(
			`Esto borra TODAS las categorías de "${race.name}". ¿Estás seguro?`
		);
		if (!ok) return;

		const { error } = await supabase
			.from('categories')
			.delete()
			.eq('race_id', race.id);

		if (error) {
			console.error('Error borrando todas:', error);
			alert('No se pudieron borrar todas las categorías.');
			return;
		}

		loadData();
	}

	// -------------------------------------------------------
	// Crear categorías masivas
	// -------------------------------------------------------
	async function handleBulkCreate() {
		if (!race) return;

		setBulkSaving(true);
		setBulkErr('');

		// 1. Distancias
		// "5,10,21" => [5,10,21]
		const distancesRaw = bulkDistances
			.split(',')
			.map((d) => d.trim())
			.filter((d) => d !== '');
		const distancesNum = distancesRaw
			.map((d) => Number(d.replace(',', '.')))
			.filter((n) => Number.isFinite(n));

		// 2. Rangos de edad
		// "18-29" una por línea
		const rangeLines = bulkRanges
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l !== '');
		const rangesParsed = rangeLines
			.map((line) => {
				const m = line.match(/^(\d{1,3})\s*[-]\s*(\d{1,3})$/);
				if (!m) return null;
				const minN = Number(m[1]);
				const maxN = Number(m[2]);
				if (!Number.isFinite(minN) || !Number.isFinite(maxN) || minN > maxN) {
					return null;
				}
				return { min: minN, max: maxN };
			})
			.filter((r) => r !== null) as { min: number; max: number }[];

		// 3. Sexos
		// multiline: "M\nF\nX\nALL"
		const sexes = bulkSexes
			.split('\n')
			.map((s) => s.trim().toUpperCase())
			.filter((s) => s !== '');

		if (
			distancesNum.length === 0 ||
			rangesParsed.length === 0 ||
			sexes.length === 0
		) {
			setBulkErr('No se pudieron interpretar distancias / rangos / sexos.');
			setBulkSaving(false);
			return;
		}

		// 4. Construir combinaciones
		const toInsert: any[] = [];

		for (const dist of distancesNum) {
			for (const sx of sexes) {
				for (const r of rangesParsed) {
					// nombre automático o manual
					let finalName = formatearNombreCategoria({
						distancia: dist,
						sexo: sx,
						edadMin: r.min,
						edadMax: r.max,
						tpl: nameTemplate,
						usarSexoLargo: sexoEnNombre,
						usarAuto: useAutoName,
					});

					toInsert.push({
						race_id: race.id,
						name: finalName,
						distance_km: dist,
						sex_filter: sx, // <-- clave, usamos sex_filter
						age_min: r.min,
						age_max: r.max,
						is_active: bulkActive,
					});
				}
			}
		}

		if (toInsert.length === 0) {
			setBulkErr('No se armó ninguna fila para insertar.');
			setBulkSaving(false);
			return;
		}

		// 5. Insert masivo
		const { error: insErr } = await supabase
			.from('categories')
			.insert(toInsert);

		if (insErr) {
			console.error('Error creando categorías masivas:', insErr);
			setBulkErr(
				insErr.message ||
					'Supabase rechazó la carga masiva. Revisá distancias / rangos / sexos.'
			);
			setBulkSaving(false);
			return;
		}

		// 6. recargar tabla
		await loadData();
		setShowBulk(false);
		setBulkSaving(false);
	}

	// -------------------------------------------------------
	// helper: generar nombre categoría
	// -------------------------------------------------------
	function formatearNombreCategoria({
		distancia,
		sexo,
		edadMin,
		edadMax,
		tpl,
		usarSexoLargo,
		usarAuto,
	}: {
		distancia: number;
		sexo: string;
		edadMin: number;
		edadMax: number;
		tpl: string;
		usarSexoLargo: boolean;
		usarAuto: boolean;
	}): string {
		if (!usarAuto) {
			// modo manual: devuelvo tpl tal cual (sin reemplazos)
			return tpl.trim() || 'Categoría';
		}

		// sexo visible en nombre
		// si usarSexoLargo === true => "M" => "MASCULINO", "F" => "FEMENINO", "X" => "X", "ALL" => "GENERAL"
		// si usarSexoLargo === false => se deja "M", "F", "X", "ALL"
		let sexoNom = sexo;
		if (usarSexoLargo) {
			if (sexo === 'M') sexoNom = 'MASCULINO';
			else if (sexo === 'F') sexoNom = 'FEMENINO';
			else if (sexo === 'X') sexoNom = 'X';
			else if (sexo === 'ALL') sexoNom = 'GENERAL';
		}

		return tpl
			.replace(/\[\[distancia\]\]/gi, String(distancia))
			.replace(/\[\[sexo\]\]/gi, sexoNom)
			.replace(/\[\[edad_min\]\]/gi, String(edadMin))
			.replace(/\[\[edad_max\]\]/gi, String(edadMax))
			.trim()
			.replace(/\s+/g, ' ');
	}

	// -------------------------------------------------------
	// RENDER
	// -------------------------------------------------------

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
					onClick={() => router.push('/admin')}
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
						onClick={() => router.push(`/admin`)}
					>
						← Admin
					</button>
					<span className='text-neutral-600'>/</span>
					<button
						className='underline text-neutral-300'
						onClick={() => router.push(`/race/${raceId}`)}
					>
						{race.name}
					</button>
					<span className='text-neutral-600'>/</span>
					<span>Categorías</span>
				</div>

				<div className='min-w-0'>
					<h1 className='text-2xl font-bold leading-tight break-words'>
						Categorías
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

			{loadErr && (
				<div className='text-red-400 text-sm bg-red-950/30 border border-red-700 rounded-lg px-3 py-2 mb-4'>
					{loadErr}
				</div>
			)}

			{/* ACCIONES */}
			<div className='flex flex-col sm:flex-row sm:items-start gap-4 mb-6'>
				<div className='flex flex-col gap-2'>
					<button
						className='bg-emerald-600 text-white font-semibold text-sm px-4 py-2 rounded-lg active:scale-95'
						onClick={openNew}
					>
						+ Nueva categoría
					</button>
					<div className='text-[10px] text-neutral-500 leading-tight'>
						Alta manual de 1 categoría.
					</div>
				</div>

				<div className='flex flex-col gap-2'>
					<button
						className='bg-blue-600 text-white font-semibold text-sm px-4 py-2 rounded-lg active:scale-95'
						onClick={() => {
							resetBulk();
							setShowBulk(true);
						}}
					>
						+ Generación masiva
					</button>
					<div className='text-[10px] text-neutral-500 leading-tight'>
						Distancias x Sexos x Rangos de edad.
					</div>
				</div>

				<div className='flex flex-col gap-2'>
					<button
						className='bg-red-700 text-white font-semibold text-sm px-4 py-2 rounded-lg active:scale-95'
						onClick={handleDeleteAll}
					>
						Borrar todas
					</button>
					<div className='text-[10px] text-neutral-500 leading-tight'>
						⚠ Irreversible (sólo esta carrera).
					</div>
				</div>
			</div>

			{/* LISTADO CATEGORÍAS */}
			<div className='border border-neutral-700 bg-neutral-900 rounded-xl overflow-hidden'>
				<div className='overflow-x-auto'>
					<table className='min-w-full text-left text-sm text-neutral-200'>
						<thead className='bg-neutral-800 text-[11px] uppercase text-neutral-400'>
							<tr>
								<th className='px-3 py-2 whitespace-nowrap'>Nombre</th>
								<th className='px-3 py-2 whitespace-nowrap'>Dist</th>
								<th className='px-3 py-2 whitespace-nowrap'>Sexo</th>
								<th className='px-3 py-2 whitespace-nowrap'>Edad min</th>
								<th className='px-3 py-2 whitespace-nowrap'>Edad max</th>
								<th className='px-3 py-2 whitespace-nowrap'>Activa</th>
								<th className='px-3 py-2 whitespace-nowrap text-right'>
									Acciones
								</th>
							</tr>
						</thead>
						<tbody>
							{categories.length === 0 ? (
								<tr>
									<td
										colSpan={7}
										className='px-3 py-4 text-center text-neutral-500 text-[12px]'
									>
										Sin categorías cargadas.
									</td>
								</tr>
							) : (
								categories.map((c, idx) => (
									<tr
										key={c.id}
										className={
											idx % 2 === 0 ? 'bg-neutral-900' : 'bg-neutral-950/40'
										}
									>
										<td className='px-3 py-2'>
											<div className='text-white text-[13px] font-semibold leading-tight'>
												{c.name}
											</div>
											<div className='text-[10px] text-neutral-500 leading-tight'>
												ID #{c.id}
											</div>
										</td>

										<td className='px-3 py-2 text-[13px] text-neutral-300'>
											{c.distance_km != null ? `${c.distance_km}K` : '—'}
										</td>

										<td className='px-3 py-2 text-[13px] text-neutral-300'>
											{c.sex_filter || '—'}
										</td>

										<td className='px-3 py-2 text-[13px] text-neutral-300'>
											{c.age_min != null ? c.age_min : '—'}
										</td>

										<td className='px-3 py-2 text-[13px] text-neutral-300'>
											{c.age_max != null ? c.age_max : '—'}
										</td>

										<td className='px-3 py-2 text-[13px]'>
											{c.is_active ? (
												<span className='text-emerald-400 font-semibold'>
													Sí
												</span>
											) : (
												<span className='text-neutral-500'>No</span>
											)}
										</td>

										<td className='px-3 py-2 text-right text-[13px] text-neutral-300'>
											<button
												className='text-emerald-400 underline text-[12px] mr-3'
												onClick={() => openEdit(c)}
											>
												Editar
											</button>
											<button
												className='text-red-400 underline text-[12px]'
												onClick={() => handleDeleteOne(c)}
											>
												Borrar
											</button>
										</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>

				<div className='p-3 text-[10px] text-neutral-500 border-t border-neutral-800'>
					Recordá activar sólo las categorías oficiales. “Recalcular categorías”
					en Participantes ignora las que estén inactivas.
				</div>
			</div>

			{/* MODAL NUEVA / EDITAR */}
			{showModal && (
				<div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'>
					<div className='w-full max-w-md bg-neutral-900 border border-neutral-700 rounded-2xl p-4 text-white'>
						<div className='flex items-start justify-between mb-3'>
							<div>
								<div className='text-lg font-semibold'>
									{editMode === 'new' ? 'Nueva categoría' : 'Editar categoría'}
								</div>
								<div className='text-[11px] text-neutral-500 leading-tight'>
									Distancia km, sexo, rango etario, activa / no activa.
								</div>
							</div>
							<button
								className='text-neutral-400 text-sm'
								onClick={() => {
									if (!saving) setShowModal(false);
								}}
							>
								✕
							</button>
						</div>

						{formErr && (
							<div className='text-red-400 text-sm bg-red-950/30 border border-red-700 rounded-lg px-3 py-2 mb-3'>
								{formErr}
							</div>
						)}

						<div className='grid grid-cols-2 gap-3 text-[13px]'>
							{/* Nombre */}
							<div className='flex flex-col col-span-2'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Nombre *
								</div>
								<input
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={formName}
									onChange={(e) => setFormName(e.target.value)}
								/>
								<div className='text-[10px] text-neutral-500 mt-1'>
									Ej: 21K FEMENINO DE 18 A 29
								</div>
							</div>

							{/* Distancia */}
							<div className='flex flex-col'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Distancia (km) *
								</div>
								<input
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={formDistance}
									onChange={(e) => setFormDistance(e.target.value)}
								/>
								<div className='text-[10px] text-neutral-500 mt-1'>
									Ej: 5 / 10 / 21
								</div>
							</div>

							{/* Sexo filtro */}
							<div className='flex flex-col'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Sexo *
								</div>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={formSexFilter}
									onChange={(e) => setFormSexFilter(e.target.value)}
								>
									<option value='M'>M</option>
									<option value='F'>F</option>
									<option value='X'>X</option>
									<option value='ALL'>ALL</option>
								</select>
								<div className='text-[10px] text-neutral-500 mt-1'>
									"ALL" = Mixta / General
								</div>
							</div>

							{/* Edad min */}
							<div className='flex flex-col'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Edad mínima
								</div>
								<input
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={formAgeMin}
									onChange={(e) => setFormAgeMin(e.target.value)}
								/>
							</div>

							{/* Edad max */}
							<div className='flex flex-col'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Edad máxima
								</div>
								<input
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={formAgeMax}
									onChange={(e) => setFormAgeMax(e.target.value)}
								/>
							</div>

							{/* Activa */}
							<div className='flex flex-col'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Activa
								</div>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={formActive ? '1' : '0'}
									onChange={(e) => setFormActive(e.target.value === '1')}
								>
									<option value='1'>Sí</option>
									<option value='0'>No</option>
								</select>
							</div>
						</div>

						<div className='flex flex-col sm:flex-row-reverse sm:justify-end gap-3 mt-4'>
							<button
								className='bg-emerald-600 text-white font-semibold text-sm px-4 py-2 rounded-lg active:scale-95 disabled:opacity-50'
								disabled={saving}
								onClick={handleSave}
							>
								{saving ? 'Guardando...' : 'Guardar'}
							</button>
							<button
								className='bg-neutral-800 text-white border border-neutral-600 font-semibold text-sm px-4 py-2 rounded-lg active:scale-95 disabled:opacity-50'
								disabled={saving}
								onClick={() => setShowModal(false)}
							>
								Cancelar
							</button>
						</div>

						<div className='text-[10px] text-neutral-600 mt-3 leading-tight'>
							Estas categorías se usan para asignar automáticamente cada
							corredor desde la pantalla de Participantes.
						</div>
					</div>
				</div>
			)}

			{/* MODAL BULK */}
			{showBulk && (
				<div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto'>
					<div className='w-full max-w-lg bg-neutral-900 border border-neutral-700 rounded-2xl p-4 text-white'>
						<div className='flex items-start justify-between mb-3'>
							<div>
								<div className='text-lg font-semibold'>
									Generación masiva de categorías
								</div>
								<div className='text-[11px] text-neutral-500 leading-tight'>
									Distancias × Sexos × Rangos de edad → muchas filas.
								</div>
							</div>
							<button
								className='text-neutral-400 text-sm'
								onClick={() => {
									if (!bulkSaving) setShowBulk(false);
								}}
							>
								✕
							</button>
						</div>

						{bulkErr && (
							<div className='text-red-400 text-sm bg-red-950/30 border border-red-700 rounded-lg px-3 py-2 mb-3'>
								{bulkErr}
							</div>
						)}

						<div className='grid grid-cols-2 gap-3 text-[13px]'>
							{/* Distancias */}
							<div className='flex flex-col col-span-2'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Distancias (km) *
								</div>
								<input
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={bulkDistances}
									onChange={(e) => setBulkDistances(e.target.value)}
									placeholder='5,10,21'
								/>
								<div className='text-[10px] text-neutral-500 mt-1'>
									Separadas por coma
								</div>
							</div>

							{/* Rangos */}
							<div className='flex flex-col col-span-2'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Rangos de edad *
								</div>
								<textarea
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white min-h-[90px]'
									value={bulkRanges}
									onChange={(e) => setBulkRanges(e.target.value)}
								/>
								<div className='text-[10px] text-neutral-500 mt-1'>
									Uno por línea, formato: 18-29
								</div>
							</div>

							{/* Sexos */}
							<div className='flex flex-col col-span-2'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Sexos a generar *
								</div>
								<textarea
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white min-h-[70px]'
									value={bulkSexes}
									onChange={(e) => setBulkSexes(e.target.value)}
								/>
								<div className='text-[10px] text-neutral-500 mt-1'>
									Ej: M / F / X / ALL (uno por línea)
								</div>
							</div>

							{/* Activa sí/no */}
							<div className='flex flex-col'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Crear como activas
								</div>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={bulkActive ? '1' : '0'}
									onChange={(e) => setBulkActive(e.target.value === '1')}
								>
									<option value='1'>Sí</option>
									<option value='0'>No</option>
								</select>
								<div className='text-[10px] text-neutral-500 mt-1'>
									Sólo las activas se usan en premiación
								</div>
							</div>

							{/* Nombre automático / template */}
							<div className='flex flex-col'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Nombre automático
								</div>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={useAutoName ? '1' : '0'}
									onChange={(e) => setUseAutoName(e.target.value === '1')}
								>
									<option value='1'>Sí</option>
									<option value='0'>No (usar texto tal cual)</option>
								</select>
								<div className='text-[10px] text-neutral-500 mt-1'>
									Si elegís "No", se usa el template literal sin reemplazos.
								</div>
							</div>

							<div className='flex flex-col'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Sexo en el nombre
								</div>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={sexoEnNombre ? '1' : '0'}
									onChange={(e) => setSexoEnNombre(e.target.value === '1')}
								>
									<option value='1'>Largo (FEMENINO / MASCULINO)</option>
									<option value='0'>Corto (F / M / ALL)</option>
								</select>
								<div className='text-[10px] text-neutral-500 mt-1'>
									Sólo aplica si Nombre automático = Sí
								</div>
							</div>

							<div className='flex flex-col col-span-2'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Plantilla nombre
								</div>
								<input
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={nameTemplate}
									onChange={(e) => setNameTemplate(e.target.value)}
								/>
								<div className='text-[10px] text-neutral-500 mt-1'>
									Placeholders: [[distancia]] [[sexo]] [[edad_min]] [[edad_max]]
								</div>
							</div>
						</div>

						<div className='flex flex-col sm:flex-row-reverse sm:justify-end gap-3 mt-4'>
							<button
								className='bg-blue-600 text-white font-semibold text-sm px-4 py-2 rounded-lg active:scale-95 disabled:opacity-50'
								disabled={bulkSaving}
								onClick={handleBulkCreate}
							>
								{bulkSaving ? 'Generando...' : 'Crear categorías masivas'}
							</button>
							<button
								className='bg-neutral-800 text-white border border-neutral-600 font-semibold text-sm px-4 py-2 rounded-lg active:scale-95 disabled:opacity-50'
								disabled={bulkSaving}
								onClick={() => setShowBulk(false)}
							>
								Cancelar
							</button>
						</div>

						<div className='text-[10px] text-neutral-600 mt-3 leading-tight'>
							Se generan TODAS las combinaciones Distancia × Sexo × Rango.
							Ejemplo: (5K, F, 21-35) se convierte en una categoría con
							sex_filter="F", distance_km=5, age_min=21, age_max=35.
						</div>
					</div>
				</div>
			)}

			{/* FOOTER */}
			<div className='mt-8 text-[11px] text-neutral-500 leading-relaxed border-t border-neutral-800 pt-4'>
				<div className='mb-2 font-medium text-neutral-300 text-[12px]'>
					Notas operativas:
				</div>
				<ol className='list-decimal list-inside space-y-1'>
					<li>
						Sólo las categorías con <b>is_active = true</b> se usan para asignar
						corredores automáticamente.
					</li>
					<li>
						El algoritmo matchea por distancia_km, sexo y edad. Si un corredor
						no tiene edad o distancia, no se le asigna categoría.
					</li>
					<li>
						Después de cargar o ajustar categorías, andá a “Participantes” y
						apretá “Recalcular categorías”.
					</li>
				</ol>
			</div>
		</main>
	);
}
