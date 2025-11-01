'use client';

import * as XLSX from 'xlsx';

import { use, useEffect, useState } from 'react';

import { supabase } from '../../../../lib/supabaseClient';
import { useRouter } from 'next/navigation';

// IMPORTANTE PARA EL IMPORT MASIVO:
// Necesitás instalar XLSX para leer .xlsx y .csv:
// npm install xlsx

type Race = {
	id: number;
	name: string;
	date: string; // usamos esto para calcular la edad si solo tenemos fecha_nacimiento
	location: string | null;
	status: string;
};

type ParticipantRow = {
	id: number;
	bib_number: number | null;
	first_name: string;
	last_name: string;
	dni: string | null;
	sex: string;
	birth_date: string | null;
	age: number | null;
	distance_km: number | null;
	category_id: number | null;
	category: { name: string }[]; // relación categories.name
};

type CategoryRow = {
	id: number;
	name: string;
	is_active: boolean;
};

export default function ParticipantsPage({
	params,
}: {
	params: Promise<{ raceId: string }>;
}) {
	const { raceId: raceIdStr } = use(params);
	const raceId = Number(raceIdStr);
	const router = useRouter();

	// Datos base
	const [race, setRace] = useState<Race | null>(null);
	const [participants, setParticipants] = useState<ParticipantRow[]>([]);
	const [categories, setCategories] = useState<CategoryRow[]>([]);
	const [loading, setLoading] = useState(true);

	// ---------------------------
	// MODAL: NUEVO PARTICIPANTE
	// ---------------------------
	const [showNewModal, setShowNewModal] = useState(false);
	const [savingNew, setSavingNew] = useState(false);
	const [newErr, setNewErr] = useState('');

	const [newBib, setNewBib] = useState('');
	const [newFirst, setNewFirst] = useState('');
	const [newLast, setNewLast] = useState('');
	const [newDni, setNewDni] = useState('');
	const [newSex, setNewSex] = useState('M'); // M / F / X
	const [newBirthDate, setNewBirthDate] = useState('');
	const [newAge, setNewAge] = useState('');
	const [newDist, setNewDist] = useState('');
	const [newCategoryId, setNewCategoryId] = useState<string>('');

	// ---------------------------
	// MODAL: EDITAR PARTICIPANTE
	// ---------------------------
	const [showEditModal, setShowEditModal] = useState(false);
	const [editErr, setEditErr] = useState('');
	const [savingEdit, setSavingEdit] = useState(false);

	const [editId, setEditId] = useState<number | null>(null);
	const [editBib, setEditBib] = useState('');
	const [editFirst, setEditFirst] = useState('');
	const [editLast, setEditLast] = useState('');
	const [editDni, setEditDni] = useState('');
	const [editSex, setEditSex] = useState('M');
	const [editBirthDate, setEditBirthDate] = useState('');
	const [editAge, setEditAge] = useState('');
	const [editDist, setEditDist] = useState('');
	const [editCategoryId, setEditCategoryId] = useState<string>('');

	// ---------------------------
	// MODAL: IMPORTAR MASIVO
	// ---------------------------
	// flujo:
	// paso 1) subir archivo -> leemos headers y filas
	// paso 2) mapear columnas
	// paso 3) importar
	const [showImportModal, setShowImportModal] = useState(false);
	const [importStep, setImportStep] = useState<'upload' | 'map' | 'confirm'>(
		'upload'
	);

	const [fileErr, setFileErr] = useState('');
	const [rawRows, setRawRows] = useState<any[]>([]); // filas crudas del Excel
	const [headers, setHeaders] = useState<string[]>([]);

	// mapeo elegido por el usuario
	const [mapFirstName, setMapFirstName] = useState('');
	const [mapLastName, setMapLastName] = useState('');
	const [mapDni, setMapDni] = useState('');
	const [mapSex, setMapSex] = useState('');
	const [mapBirthDate, setMapBirthDate] = useState('');
	const [mapAge, setMapAge] = useState('');
	const [mapDist, setMapDist] = useState('');
	const [mapBib, setMapBib] = useState('');

	const [importErr, setImportErr] = useState('');
	const [importing, setImporting] = useState(false);

	// -------------------------------------------------
	// Utilidades
	// -------------------------------------------------

	// parsea una fecha tipo "DD/MM/YYYY" o "YYYY-MM-DD" y la devuelve en ISO "YYYY-MM-DD"
	function normalizeBirthDate(str: string): string | null {
		if (!str) return null;
		const v = str.trim();
		if (!v) return null;

		// caso YYYY-MM-DD
		if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
			return v;
		}

		// caso DD/MM/YYYY
		const m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
		if (m) {
			const dd = m[1].padStart(2, '0');
			const mm = m[2].padStart(2, '0');
			const yyyy = m[3];
			return `${yyyy}-${mm}-${dd}`;
		}

		// caso DD-MM-YYYY, DD.MM.YYYY, etc. Se puede ampliar.
		const m2 = v.match(/^(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})$/);
		if (m2) {
			const dd = m2[1].padStart(2, '0');
			const mm = m2[2].padStart(2, '0');
			const yyyy = m2[3];
			return `${yyyy}-${mm}-${dd}`;
		}

		// si no pudimos parsear, devolvemos null
		return null;
	}

	// calcula edad a partir de fecha de nacimiento y fecha de carrera
	function calcAge(
		birthISO: string | null,
		raceDateISO: string | null
	): number | null {
		if (!birthISO || !raceDateISO) return null;
		const b = new Date(birthISO + 'T00:00:00');
		const r = new Date(raceDateISO + 'T00:00:00');

		if (isNaN(b.getTime()) || isNaN(r.getTime())) return null;

		let age = r.getFullYear() - b.getFullYear();
		const mDiff = r.getMonth() - b.getMonth();
		if (mDiff < 0 || (mDiff === 0 && r.getDate() < b.getDate())) {
			age = age - 1;
		}
		if (age < 0 || age > 120) return null; // sanity check
		return age;
	}

	function parseNumberOrNull(v: string): number | null {
		if (!v || !v.trim()) return null;
		const n = Number(v.replace(',', '.'));
		if (!Number.isFinite(n)) return null;
		return n;
	}

	// -------------------------------------------------
	// Cargar data inicial
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

		// categorías (para elegir categoría manualmente, por si querés forzar)
		const { data: catData, error: catErr } = await supabase
			.from('categories')
			.select('id, name, is_active')
			.eq('race_id', raceId)
			.order('distance_km', { ascending: true })
			.order('age_min', { ascending: true });

		if (catErr) {
			console.error('Error cargando categorías:', catErr);
			setCategories([]);
		} else {
			setCategories(catData as CategoryRow[]);
		}

		// participantes
		// traemos también category.name para mostrar
		const { data: partData, error: partErr } = await supabase
			.from('participants')
			.select(
				'id, bib_number, first_name, last_name, dni, sex, birth_date, age, distance_km, category_id, category:category_id(name)'
			)
			.eq('race_id', raceId)
			.order('bib_number', { ascending: true });

		if (partErr) {
			console.error('Error cargando participantes:', partErr);
			setParticipants([]);
		} else {
			setParticipants(partData as ParticipantRow[]);
		}

		setLoading(false);
	}

	useEffect(() => {
		loadData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [raceId]);

	// -------------------------------------------------
	// Alta manual
	// -------------------------------------------------

	async function handleCreateParticipant() {
		if (!race) {
			setNewErr('No hay carrera cargada.');
			return;
		}

		setSavingNew(true);
		setNewErr('');

		if (!newFirst.trim() || !newLast.trim()) {
			setNewErr('Nombre y Apellido son obligatorios.');
			setSavingNew(false);
			return;
		}

		if (!newSex.trim()) {
			setNewErr('Sexo es obligatorio.');
			setSavingNew(false);
			return;
		}

		const distNum = parseNumberOrNull(newDist);
		if (distNum === null || distNum <= 0) {
			setNewErr('Distancia inválida.');
			setSavingNew(false);
			return;
		}

		// validación edad / fecha nacimiento
		const birthISO = normalizeBirthDate(newBirthDate);
		let finalAge: number | null = null;

		if (birthISO) {
			finalAge = calcAge(birthISO, race.date);
		}

		if (!birthISO && newAge.trim()) {
			// si no tenemos fecha_nacimiento pero sí edad
			const tmpAge = Number(newAge);
			if (Number.isFinite(tmpAge) && tmpAge >= 0 && tmpAge <= 120) {
				finalAge = tmpAge;
			} else {
				setNewErr('Edad inválida.');
				setSavingNew(false);
				return;
			}
		}

		if (!birthISO && finalAge === null) {
			setNewErr('Necesitamos Fecha de nacimiento o Edad (al menos una).');
			setSavingNew(false);
			return;
		}

		const bibNum = parseNumberOrNull(newBib);

		// insert
		const { error: insErr } = await supabase.from('participants').insert([
			{
				race_id: race.id,
				bib_number: bibNum,
				first_name: newFirst.trim(),
				last_name: newLast.trim(),
				dni: newDni.trim() || null,
				sex: newSex.trim(),
				birth_date: birthISO,
				age: finalAge,
				distance_km: distNum,
				category_id: newCategoryId ? Number(newCategoryId) : null,
			},
		]);

		if (insErr) {
			console.error('Error creando participante:', insErr);
			setNewErr('No se pudo crear el participante.');
			setSavingNew(false);
			return;
		}

		// reseteo modal
		setNewBib('');
		setNewFirst('');
		setNewLast('');
		setNewDni('');
		setNewSex('M');
		setNewBirthDate('');
		setNewAge('');
		setNewDist('');
		setNewCategoryId('');
		setShowNewModal(false);
		setSavingNew(false);

		loadData();
	}

	// -------------------------------------------------
	// Editar participante
	// -------------------------------------------------

	function openEditModal(p: ParticipantRow) {
		setEditId(p.id);
		setEditBib(p.bib_number ? String(p.bib_number) : '');
		setEditFirst(p.first_name || '');
		setEditLast(p.last_name || '');
		setEditDni(p.dni || '');
		setEditSex(p.sex || 'M');
		setEditBirthDate(p.birth_date || '');
		setEditAge(p.age ? String(p.age) : '');
		setEditDist(p.distance_km ? String(p.distance_km) : '');
		setEditCategoryId(p.category_id ? String(p.category_id) : '');
		setEditErr('');
		setShowEditModal(true);
	}

	async function handleSaveEdit() {
		if (!race) {
			setEditErr('No hay carrera cargada.');
			return;
		}
		if (editId == null) return;

		setSavingEdit(true);
		setEditErr('');

		if (!editFirst.trim() || !editLast.trim()) {
			setEditErr('Nombre y Apellido son obligatorios.');
			setSavingEdit(false);
			return;
		}

		if (!editSex.trim()) {
			setEditErr('Sexo es obligatorio.');
			setSavingEdit(false);
			return;
		}

		const distNum = parseNumberOrNull(editDist);
		if (distNum === null || distNum <= 0) {
			setEditErr('Distancia inválida.');
			setSavingEdit(false);
			return;
		}

		// edad/fecha_nacimiento
		const birthISO = normalizeBirthDate(editBirthDate);
		let finalAge: number | null = null;

		if (birthISO) {
			finalAge = calcAge(birthISO, race.date);
		}

		if (!birthISO && editAge.trim()) {
			const tmpAge = Number(editAge);
			if (Number.isFinite(tmpAge) && tmpAge >= 0 && tmpAge <= 120) {
				finalAge = tmpAge;
			} else {
				setEditErr('Edad inválida.');
				setSavingEdit(false);
				return;
			}
		}

		if (!birthISO && finalAge === null) {
			setEditErr('Necesitamos Fecha de nacimiento o Edad (al menos una).');
			setSavingEdit(false);
			return;
		}

		const bibNum = parseNumberOrNull(editBib);

		const { error: upErr } = await supabase
			.from('participants')
			.update({
				bib_number: bibNum,
				first_name: editFirst.trim(),
				last_name: editLast.trim(),
				dni: editDni.trim() || null,
				sex: editSex.trim(),
				birth_date: birthISO,
				age: finalAge,
				distance_km: distNum,
				category_id: editCategoryId ? Number(editCategoryId) : null,
			})
			.eq('id', editId)
			.eq('race_id', raceId);

		if (upErr) {
			console.error('Error actualizando participante:', upErr);
			setEditErr('No se pudo guardar el participante.');
			setSavingEdit(false);
			return;
		}

		setShowEditModal(false);
		setSavingEdit(false);
		loadData();
	}

	// -------------------------------------------------
	// IMPORTAR MASIVO
	// -------------------------------------------------

	function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;

		setFileErr('');
		setImportErr('');
		setImportStep('upload');

		const reader = new FileReader();
		reader.onload = (evt) => {
			const data = evt.target?.result;
			if (!data) {
				setFileErr('No se pudo leer el archivo.');
				return;
			}
			// XLSX lee tanto xlsx como csv
			const workbook = XLSX.read(data, { type: 'binary' });
			const sheetName = workbook.SheetNames[0];
			const sheet = workbook.Sheets[sheetName];
			const json: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

			if (!json.length) {
				setFileErr('El archivo está vacío.');
				return;
			}

			// headers = keys del primer row
			const hdrs = Object.keys(json[0]);
			setHeaders(hdrs);
			setRawRows(json);
			setImportStep('map');

			// reseteo mapping anterior
			setMapFirstName('');
			setMapLastName('');
			setMapDni('');
			setMapSex('');
			setMapBirthDate('');
			setMapAge('');
			setMapDist('');
			setMapBib('');
		};
		reader.readAsBinaryString(file);
	}

	function buildOptionsForMapping() {
		return (
			<>
				<option value=''>-- seleccionar columna --</option>
				{headers.map((h) => (
					<option key={h} value={h}>
						{h}
					</option>
				))}
			</>
		);
	}

	// Genera el payload final que vamos a enviar a Supabase
	function buildImportPayload() {
		if (!race) return { ok: false, err: 'No hay carrera cargada', rows: [] };

		const finalRows: any[] = [];
		for (const row of rawRows) {
			// tomo cada campo según el mapping elegido
			const fn = mapFirstName ? String(row[mapFirstName] || '').trim() : '';
			const ln = mapLastName ? String(row[mapLastName] || '').trim() : '';
			const dni = mapDni ? String(row[mapDni] || '').trim() : '';
			const sx = mapSex
				? String(row[mapSex] || '')
						.trim()
						.toUpperCase()
				: '';
			const bdRaw = mapBirthDate ? String(row[mapBirthDate] || '').trim() : '';
			const agRaw = mapAge ? String(row[mapAge] || '').trim() : '';
			const distRaw = mapDist ? String(row[mapDist] || '').trim() : '';
			const bibRaw = mapBib ? String(row[mapBib] || '').trim() : '';

			// validaciones mínimas
			if (!fn || !ln || !sx || !distRaw) {
				return {
					ok: false,
					err: 'Faltan columnas obligatorias. Necesitamos al menos Nombre, Apellido, Sexo y Distancia.',
					rows: [],
				};
			}

			const distNum = Number(distRaw.replace(',', '.'));
			if (!Number.isFinite(distNum) || distNum <= 0) {
				return {
					ok: false,
					err: `Distancia inválida para ${fn} ${ln}.`,
					rows: [],
				};
			}

			// edad / fecha nacimiento
			const birthISO = normalizeBirthDate(bdRaw);
			let finalAge: number | null = null;

			if (birthISO) {
				finalAge = calcAge(birthISO, race.date);
			}

			if (!birthISO && agRaw) {
				const agNum = Number(agRaw);
				if (Number.isFinite(agNum) && agNum >= 0 && agNum <= 120) {
					finalAge = agNum;
				} else {
					return {
						ok: false,
						err: `Edad inválida para ${fn} ${ln}.`,
						rows: [],
					};
				}
			}

			if (!birthISO && finalAge === null) {
				return {
					ok: false,
					err: `Necesitamos Fecha de nacimiento o Edad para ${fn} ${ln}.`,
					rows: [],
				};
			}

			const bibNumParsed = bibRaw ? Number(bibRaw.replace(',', '.')) : null;
			const bibNumFinal =
				bibNumParsed && Number.isFinite(bibNumParsed) ? bibNumParsed : null;

			finalRows.push({
				race_id: race.id,
				bib_number: bibNumFinal,
				first_name: fn,
				last_name: ln,
				dni: dni || null,
				sex: sx,
				birth_date: birthISO,
				age: finalAge,
				distance_km: distNum,
				category_id: null, // la asignamos más tarde con "recalcular categorías"
			});
		}

		return { ok: true, err: '', rows: finalRows };
	}

	async function handleImportToSupabase() {
		if (!race) {
			setImportErr('No hay carrera cargada.');
			return;
		}

		setImportErr('');
		setImporting(true);

		const result = buildImportPayload();
		if (!result.ok) {
			setImportErr(result.err);
			setImporting(false);
			return;
		}

		if (result.rows.length === 0) {
			setImportErr('No se detectaron filas para importar.');
			setImporting(false);
			return;
		}

		const { error: bulkErr } = await supabase
			.from('participants')
			.insert(result.rows);

		if (bulkErr) {
			console.error('Error importando participantes:', bulkErr);
			setImportErr(
				'Supabase rechazó la importación masiva. Verificá mapeo y datos.'
			);
			setImporting(false);
			return;
		}

		// éxito → reseteo modal
		setShowImportModal(false);
		setImportStep('upload');
		setRawRows([]);
		setHeaders([]);
		setMapFirstName('');
		setMapLastName('');
		setMapDni('');
		setMapSex('');
		setMapBirthDate('');
		setMapAge('');
		setMapDist('');
		setMapBib('');
		setImporting(false);

		loadData();
	}

	// -------------------------------------------------
	// RENDER
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
					<span>Participantes</span>
				</div>

				<div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3'>
					<div className='min-w-0'>
						<h1 className='text-2xl font-bold leading-tight break-words'>
							Participantes · {race.name}
						</h1>
						<div className='text-sm text-neutral-400'>
							{race.date} · {race.location || 'Sin ubicación'}
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
							+ Participante
						</button>

						<button
							className='bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg active:scale-95 w-full sm:w-auto'
							onClick={() => {
								setFileErr('');
								setImportErr('');
								setImportStep('upload');
								setShowImportModal(true);
							}}
						>
							⬆ Importar Excel / CSV
						</button>
					</div>
				</div>
			</div>

			{/* LISTA PARTICIPANTES */}
			{participants.length === 0 ? (
				<div className='text-neutral-400 text-sm'>
					No hay participantes cargados.
				</div>
			) : (
				<ul className='flex flex-col gap-2'>
					{participants.map((p) => (
						<li
							key={p.id}
							className='border border-neutral-700 bg-neutral-900 rounded-xl p-3 text-sm flex flex-col gap-2'
						>
							<div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2'>
								<div className='flex flex-col min-w-0'>
									<div className='flex items-center flex-wrap gap-2'>
										<div className='text-white font-semibold leading-tight break-words'>
											#{p.bib_number ?? '—'} · {p.first_name} {p.last_name}
										</div>
										<div className='text-[11px] text-neutral-400 leading-tight'>
											DNI {p.dni || '—'}
										</div>
									</div>

									<div className='text-[11px] text-neutral-400 flex flex-wrap gap-2 leading-tight mt-1'>
										<span>Sexo: {p.sex || '?'}</span>
										<span>Edad: {p.age != null ? p.age : '—'}</span>
										<span>
											Dist: {p.distance_km != null ? `${p.distance_km}K` : '—'}
										</span>
										<span>
											Cat:{' '}
											{p.category && p.category.length > 0
												? p.category[0].name
												: '—'}
										</span>
									</div>
								</div>

								<div className='flex flex-row flex-wrap items-center gap-2 shrink-0'>
									<button
										className='text-[11px] bg-neutral-800 border border-neutral-600 rounded px-2 py-1 text-neutral-200 active:scale-95'
										onClick={() => openEditModal(p)}
									>
										Editar
									</button>
								</div>
							</div>
						</li>
					))}
				</ul>
			)}

			{/* MODAL NUEVO PARTICIPANTE */}
			{showNewModal && (
				<div className='fixed inset-0 flex items-center justify-center bg-black/70 p-4 z-[60]'>
					<div className='w-full max-w-sm bg-neutral-900 border border-neutral-700 rounded-xl p-4 flex flex-col gap-4'>
						<div className='flex items-start justify-between'>
							<div className='text-lg font-semibold text-white'>
								Nuevo participante
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

						{/* Bib */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Dorsal / Pechera (opcional)</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={newBib}
								onChange={(e) => setNewBib(e.target.value)}
								disabled={savingNew}
								placeholder='123'
							/>
						</label>

						{/* Nombre / Apellido */}
						<div className='grid grid-cols-2 gap-3'>
							<label className='text-sm flex flex-col gap-1'>
								<span>Nombre *</span>
								<input
									className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
									value={newFirst}
									onChange={(e) => setNewFirst(e.target.value)}
									disabled={savingNew}
								/>
							</label>

							<label className='text-sm flex flex-col gap-1'>
								<span>Apellido *</span>
								<input
									className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
									value={newLast}
									onChange={(e) => setNewLast(e.target.value)}
									disabled={savingNew}
								/>
							</label>
						</div>

						{/* DNI */}
						<label className='text-sm flex flex-col gap-1'>
							<span>DNI / Documento (opcional)</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={newDni}
								onChange={(e) => setNewDni(e.target.value)}
								disabled={savingNew}
							/>
						</label>

						{/* Sexo */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Sexo *</span>
							<select
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={newSex}
								onChange={(e) => setNewSex(e.target.value)}
								disabled={savingNew}
							>
								<option value='M'>M</option>
								<option value='F'>F</option>
								<option value='X'>X</option>
							</select>
						</label>

						{/* Fecha Nac / Edad */}
						<div className='grid grid-cols-2 gap-3'>
							<label className='text-sm flex flex-col gap-1'>
								<span>Fecha de nacimiento (DD/MM/YYYY o YYYY-MM-DD)</span>
								<input
									className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-[13px]'
									value={newBirthDate}
									onChange={(e) => setNewBirthDate(e.target.value)}
									disabled={savingNew}
									placeholder='1988-05-21'
								/>
							</label>

							<label className='text-sm flex flex-col gap-1'>
								<span>Edad (si no hay fecha)</span>
								<input
									className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-[13px]'
									value={newAge}
									onChange={(e) => setNewAge(e.target.value)}
									disabled={savingNew}
									placeholder='36'
								/>
							</label>
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

						{/* Categoría forzada (opcional) */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Categoría (opcional)</span>
							<select
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={newCategoryId}
								onChange={(e) => setNewCategoryId(e.target.value)}
								disabled={savingNew}
							>
								<option value=''>(auto luego)</option>
								{categories.map((c) => (
									<option value={String(c.id)} key={c.id}>
										{c.name} {c.is_active ? '' : '(inactiva)'}
									</option>
								))}
							</select>
						</label>

						<button
							className='w-full bg-emerald-600 text-white font-semibold text-base px-4 py-3 rounded-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100'
							disabled={savingNew}
							onClick={handleCreateParticipant}
						>
							{savingNew ? 'Guardando...' : 'Crear participante'}
						</button>
					</div>
				</div>
			)}

			{/* MODAL EDITAR PARTICIPANTE */}
			{showEditModal && (
				<div className='fixed inset-0 flex items-center justify-center bg-black/70 p-4 z-[70]'>
					<div className='w-full max-w-sm bg-neutral-900 border border-neutral-700 rounded-xl p-4 flex flex-col gap-4'>
						<div className='flex items-start justify-between'>
							<div className='text-lg font-semibold text-white'>
								Editar participante
							</div>
							<button
								className='text-neutral-400 text-sm'
								disabled={savingEdit}
								onClick={() => {
									if (!savingEdit) {
										setShowEditModal(false);
										setEditErr('');
									}
								}}
							>
								✕
							</button>
						</div>

						{editErr && <div className='text-red-400 text-sm'>{editErr}</div>}

						{/* Bib */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Dorsal / Pechera</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={editBib}
								onChange={(e) => setEditBib(e.target.value)}
								disabled={savingEdit}
							/>
						</label>

						{/* Nombre / Apellido */}
						<div className='grid grid-cols-2 gap-3'>
							<label className='text-sm flex flex-col gap-1'>
								<span>Nombre *</span>
								<input
									className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
									value={editFirst}
									onChange={(e) => setEditFirst(e.target.value)}
									disabled={savingEdit}
								/>
							</label>

							<label className='text-sm flex flex-col gap-1'>
								<span>Apellido *</span>
								<input
									className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
									value={editLast}
									onChange={(e) => setEditLast(e.target.value)}
									disabled={savingEdit}
								/>
							</label>
						</div>

						{/* DNI */}
						<label className='text-sm flex flex-col gap-1'>
							<span>DNI / Documento</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={editDni}
								onChange={(e) => setEditDni(e.target.value)}
								disabled={savingEdit}
							/>
						</label>

						{/* Sexo */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Sexo *</span>
							<select
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={editSex}
								onChange={(e) => setEditSex(e.target.value)}
								disabled={savingEdit}
							>
								<option value='M'>M</option>
								<option value='F'>F</option>
								<option value='X'>X</option>
							</select>
						</label>

						{/* Fecha Nac / Edad */}
						<div className='grid grid-cols-2 gap-3'>
							<label className='text-sm flex flex-col gap-1'>
								<span>Fecha de nacimiento</span>
								<input
									className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-[13px]'
									value={editBirthDate}
									onChange={(e) => setEditBirthDate(e.target.value)}
									disabled={savingEdit}
									placeholder='1988-05-21'
								/>
							</label>

							<label className='text-sm flex flex-col gap-1'>
								<span>Edad (si no hay fecha)</span>
								<input
									className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-[13px]'
									value={editAge}
									onChange={(e) => setEditAge(e.target.value)}
									disabled={savingEdit}
									placeholder='36'
								/>
							</label>
						</div>

						{/* Distancia */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Distancia (km) *</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={editDist}
								onChange={(e) => setEditDist(e.target.value)}
								disabled={savingEdit}
							/>
						</label>

						{/* Categoría */}
						<label className='text-sm flex flex-col gap-1'>
							<span>Categoría (opcional)</span>
							<select
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={editCategoryId}
								onChange={(e) => setEditCategoryId(e.target.value)}
								disabled={savingEdit}
							>
								<option value=''>(auto / sin categoría)</option>
								{categories.map((c) => (
									<option value={String(c.id)} key={c.id}>
										{c.name} {c.is_active ? '' : '(inactiva)'}
									</option>
								))}
							</select>
						</label>

						<button
							className='w-full bg-blue-600 text-white font-semibold text-base px-4 py-3 rounded-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100'
							disabled={savingEdit}
							onClick={handleSaveEdit}
						>
							{savingEdit ? 'Guardando...' : 'Guardar cambios'}
						</button>
					</div>
				</div>
			)}

			{/* MODAL IMPORTACIÓN MASIVA */}
			{showImportModal && (
				<div className='fixed inset-0 flex items-center justify-center bg-black/70 p-4 z-[80]'>
					<div className='w-full max-w-sm bg-neutral-900 border border-neutral-700 rounded-xl p-4 flex flex-col gap-4 max-h-[90vh] overflow-y-auto'>
						<div className='flex items-start justify-between'>
							<div className='text-lg font-semibold text-white'>
								Importar participantes
							</div>
							<button
								className='text-neutral-400 text-sm'
								disabled={importing}
								onClick={() => {
									if (!importing) {
										setShowImportModal(false);
										setFileErr('');
										setImportErr('');
										setImportStep('upload');
									}
								}}
							>
								✕
							</button>
						</div>

						{importStep === 'upload' && (
							<>
								<div className='text-xs text-neutral-400 leading-snug'>
									Subí un archivo .xlsx o .csv con columnas.
									<br />
									Columnas mínimas que vamos a necesitar:
									<br />
									- nombre
									<br />
									- apellido
									<br />
									- sexo
									<br />
									- distancia_km
									<br />
									Y al menos una de:
									<br />
									- fecha_nacimiento (DD/MM/YYYY o YYYY-MM-DD)
									<br />
									- edad
									<br />
									Dorsal (pechera) es opcional.
								</div>

								{fileErr && (
									<div className='text-red-400 text-sm'>{fileErr}</div>
								)}

								<label className='text-sm flex flex-col gap-2'>
									<span>Archivo Excel / CSV</span>
									<input
										type='file'
										accept='.xlsx,.xls,.csv'
										className='text-white text-xs'
										onChange={handleFileChosen}
										disabled={importing}
									/>
								</label>
							</>
						)}

						{importStep === 'map' && (
							<>
								<div className='text-xs text-neutral-400 leading-snug space-y-2'>
									<p>
										Mapeá las columnas de tu archivo con los campos del sistema.{' '}
										<strong>
											Tenés que dar al menos Fecha de nacimiento o Edad.
										</strong>
									</p>
									<p className='text-[10px] text-neutral-500 leading-tight'>
										Ejemplo de sexo: M / F / X. Distancia: 5, 10, 21, etc.
									</p>
								</div>

								{importErr && (
									<div className='text-red-400 text-sm'>{importErr}</div>
								)}

								<div className='flex flex-col gap-2 text-[13px] text-neutral-200'>
									<label className='flex flex-col gap-1'>
										<span>Nombre *</span>
										<select
											className='bg-neutral-800 border border-neutral-600 rounded-lg px-2 py-2'
											value={mapFirstName}
											onChange={(e) => setMapFirstName(e.target.value)}
										>
											{buildOptionsForMapping()}
										</select>
									</label>

									<label className='flex flex-col gap-1'>
										<span>Apellido *</span>
										<select
											className='bg-neutral-800 border border-neutral-600 rounded-lg px-2 py-2'
											value={mapLastName}
											onChange={(e) => setMapLastName(e.target.value)}
										>
											{buildOptionsForMapping()}
										</select>
									</label>

									<label className='flex flex-col gap-1'>
										<span>DNI (opcional)</span>
										<select
											className='bg-neutral-800 border border-neutral-600 rounded-lg px-2 py-2'
											value={mapDni}
											onChange={(e) => setMapDni(e.target.value)}
										>
											{buildOptionsForMapping()}
										</select>
									</label>

									<label className='flex flex-col gap-1'>
										<span>Sexo *</span>
										<select
											className='bg-neutral-800 border border-neutral-600 rounded-lg px-2 py-2'
											value={mapSex}
											onChange={(e) => setMapSex(e.target.value)}
										>
											{buildOptionsForMapping()}
										</select>
									</label>

									<label className='flex flex-col gap-1'>
										<span>Fecha de nacimiento (si la tenés)</span>
										<select
											className='bg-neutral-800 border border-neutral-600 rounded-lg px-2 py-2'
											value={mapBirthDate}
											onChange={(e) => setMapBirthDate(e.target.value)}
										>
											{buildOptionsForMapping()}
										</select>
										<span className='text-[10px] text-neutral-500 leading-tight'>
											Formato DD/MM/YYYY o YYYY-MM-DD
										</span>
									</label>

									<label className='flex flex-col gap-1'>
										<span>Edad (si NO tenés fecha)</span>
										<select
											className='bg-neutral-800 border border-neutral-600 rounded-lg px-2 py-2'
											value={mapAge}
											onChange={(e) => setMapAge(e.target.value)}
										>
											{buildOptionsForMapping()}
										</select>
									</label>

									<label className='flex flex-col gap-1'>
										<span>Distancia (km) *</span>
										<select
											className='bg-neutral-800 border border-neutral-600 rounded-lg px-2 py-2'
											value={mapDist}
											onChange={(e) => setMapDist(e.target.value)}
										>
											{buildOptionsForMapping()}
										</select>
										<span className='text-[10px] text-neutral-500 leading-tight'>
											Ej: 5 / 10 / 21
										</span>
									</label>

									<label className='flex flex-col gap-1'>
										<span>Dorsal / Pechera (opcional)</span>
										<select
											className='bg-neutral-800 border border-neutral-600 rounded-lg px-2 py-2'
											value={mapBib}
											onChange={(e) => setMapBib(e.target.value)}
										>
											{buildOptionsForMapping()}
										</select>
									</label>
								</div>

								<button
									className='w-full bg-blue-600 text-white font-semibold text-base px-4 py-3 rounded-lg active:scale-95'
									onClick={() => {
										// validaciones mínimas para pasar a confirm
										if (!mapFirstName || !mapLastName || !mapSex || !mapDist) {
											setImportErr(
												'Mínimo: Nombre, Apellido, Sexo y Distancia.'
											);
											return;
										}
										if (!mapBirthDate && !mapAge) {
											setImportErr(
												'Mapeá al menos Fecha de nacimiento o Edad.'
											);
											return;
										}
										setImportErr('');
										setImportStep('confirm');
									}}
								>
									Continuar
								</button>
							</>
						)}

						{importStep === 'confirm' && (
							<>
								<div className='text-xs text-neutral-400 leading-snug space-y-2'>
									<p>
										Revisá y confirmá. Vamos a importar todos los participantes
										mapeados.
									</p>
									<p className='text-[10px] text-neutral-500 leading-tight'>
										Después podés recalcular categorías desde la carrera.
									</p>
								</div>

								{importErr && (
									<div className='text-red-400 text-sm'>{importErr}</div>
								)}

								<div className='bg-neutral-800 border border-neutral-600 rounded-lg p-2 text-[11px] text-neutral-300 max-h-40 overflow-y-auto'>
									{rawRows.slice(0, 10).map((r, idx) => (
										<div
											key={idx}
											className='border-b border-neutral-700 py-1 last:border-b-0'
										>
											<div className='font-mono break-all text-[10px]'>
												{JSON.stringify(r)}
											</div>
										</div>
									))}
									{rawRows.length > 10 && (
										<div className='text-[10px] text-neutral-500 mt-2'>
											... y {rawRows.length - 10} filas más
										</div>
									)}
								</div>

								<button
									className='w-full bg-emerald-600 text-white font-semibold text-base px-4 py-3 rounded-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100'
									disabled={importing}
									onClick={handleImportToSupabase}
								>
									{importing ? 'Importando...' : 'Importar participantes'}
								</button>

								<button
									className='w-full bg-neutral-800 border border-neutral-600 text-white font-semibold text-base px-4 py-3 rounded-lg active:scale-95 disabled:opacity-50'
									disabled={importing}
									onClick={() => {
										if (!importing) {
											setImportStep('map');
										}
									}}
								>
									Volver a mapeo
								</button>
							</>
						)}
					</div>
				</div>
			)}
		</main>
	);
}
