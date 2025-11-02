'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../../lib/supabaseClient';
import * as Papa from 'papaparse';
import * as XLSX from 'xlsx';

type Race = {
	id: number;
	name: string;
	date: string;
	location: string | null;
	status: string;
};

type ParticipantRow = {
	id: number;
	bib_number: number | null;
	chip: string | null;
	first_name: string;
	last_name: string;
	dni: string | null;
	sex: string;
	birth_date: string | null;
	age: number | null;
	distance_km: number | null;
	category_id: number | null;
};

type FailedImportRow = {
	rowData: any;
	errorMsg: string;
};

type CategoryRow = {
	id: number;
	race_id: number;
	name: string;
	distance_km: number | null;
	sex_filter: string; // "M" | "F" | "X" | "ALL"
	age_min: number | null;
	age_max: number | null;
	is_active: boolean;
};

// ============ HELPERS DE LIMPIEZA / NORMALIZACIÓN ============

// Limpia nombre/apellido: recorta y colapsa espacios múltiples.
function cleanName(v: any): string {
	let s = String(v ?? '').trim();
	s = s.replace(/\s+/g, ' ');
	return s;
}

// Deja sólo dígitos (para DNI, edad, dorsal).
function cleanDigits(v: any): string {
	return String(v ?? '').replace(/[^\d]/g, '');
}

// Distancia: sacamos espacios primero.
function sanitizeDistanceRaw(v: any): string {
	return String(v ?? '').replace(/\s+/g, '');
}

// Extrae número de "10K", "21km", "5,5", etc.
function extractNumberLike(v: any): number | null {
	if (v === undefined || v === null) return null;
	const s = String(v).trim();
	if (!s) return null;
	const m = s.match(/(\d+[.,]?\d*)/);
	if (!m) return null;
	const candidate = m[1].replace(',', '.');
	const n = Number(candidate);
	if (!Number.isFinite(n)) return null;
	return n;
}

// Edad: sólo dígitos válidos
function extractAgeInt(v: any): number | null {
	const digits = cleanDigits(v);
	if (!digits) return null;
	const n = Number(digits);
	if (!Number.isFinite(n)) return null;
	if (n < 0 || n > 120) return null;
	return n;
}

// Sexo normalizado
function normalizeSex(v: any): string {
	if (!v && v !== 0) return '';
	const s = String(v).trim().toUpperCase();
	if (s === 'M' || s.startsWith('MAS')) return 'M';
	if (s === 'F' || s.startsWith('FEM')) return 'F';
	if (s === 'X' || s.startsWith('NO') || s.startsWith('NB')) return 'X';
	if (
		s === 'ALL' ||
		s === 'GENERAL' ||
		s === 'G' ||
		s === 'GEN' ||
		s.includes('TODOS')
	)
		return 'ALL';
	return s;
}

// Fecha -> YYYY-MM-DD
function normalizeDate(v: any): string | null {
	if (!v) return null;
	if (v instanceof Date && !isNaN(v.getTime())) {
		return v.toISOString().slice(0, 10);
	}

	const raw = String(v).trim();
	if (!raw) return null;

	// dd/mm/yyyy o dd-mm-yyyy
	let m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
	if (m) {
		let dd = m[1].padStart(2, '0');
		let mm = m[2].padStart(2, '0');
		let yyyy = m[3];
		if (yyyy.length === 2) {
			const yrNum = Number(yyyy);
			yyyy = yrNum < 30 ? '20' + yyyy : '19' + yyyy;
		}
		return `${yyyy}-${mm}-${dd}`;
	}

	// yyyy-mm-dd o yyyy/mm/dd
	m = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
	if (m) {
		const yyyy = m[1];
		const mm = m[2].padStart(2, '0');
		const dd = m[3].padStart(2, '0');
		return `${yyyy}-${mm}-${dd}`;
	}

	return null;
}

// Calcula edad final:
function deriveAge(
	birthISO: string | null,
	cleanedAgeDigits: any
): number | null {
	const direct = extractAgeInt(cleanedAgeDigits);
	if (direct !== null) return direct;

	if (!birthISO) return null;

	const [Y, M, D] = birthISO.split('-');
	const by = Number(Y);
	const bm = Number(M) - 1;
	const bd = Number(D);

	if (!Number.isFinite(by) || !Number.isFinite(bm) || !Number.isFinite(bd)) {
		return null;
	}

	const bDate = new Date(by, bm, bd);
	if (isNaN(bDate.getTime())) return null;

	const today = new Date();
	let years = today.getFullYear() - bDate.getFullYear();
	const mDiff = today.getMonth() - bDate.getMonth();
	if (mDiff < 0 || (mDiff === 0 && today.getDate() < bDate.getDate())) {
		years -= 1;
	}
	if (years < 0 || years > 120) return null;
	return years;
}

// chip = "LT" + dorsal padded a 5 dígitos.
// dorsal "152" => "LT00152"
function makeChipFromBibNumberString(bibDigits: string): string | null {
	if (!bibDigits) return null;
	if (bibDigits.length > 5) return null;
	const padded = bibDigits.padStart(5, '0');
	return 'LT' + padded;
}

// ============================================================

export default function ParticipantsPage({
	params,
}: {
	params: Promise<{ raceId: string }>;
}) {
	const { raceId: raceIdStr } = use(params);
	const raceId = Number(raceIdStr);
	const router = useRouter();

	// Carrera
	const [race, setRace] = useState<Race | null>(null);

	// Participantes en BD
	const [participants, setParticipants] = useState<ParticipantRow[]>([]);
	const [loading, setLoading] = useState(true);

	// Para validar DNI único
	const [existingDnis, setExistingDnis] = useState<Set<string>>(new Set());

	// KPI / búsqueda
	const [searchQ, setSearchQ] = useState('');

	// IMPORTACIÓN MASIVA
	const [rawHeaders, setRawHeaders] = useState<string[]>([]);
	const [rawRows, setRawRows] = useState<Record<string, any>[]>([]);
	const [importStep, setImportStep] = useState<'idle' | 'mapped' | 'ready'>(
		'idle'
	);

	const [mapFirstName, setMapFirstName] = useState<string>('');
	const [mapLastName, setMapLastName] = useState<string>('');
	const [mapDni, setMapDni] = useState<string>('');
	const [mapSex, setMapSex] = useState<string>('');
	const [mapBirthDate, setMapBirthDate] = useState<string>('');
	const [mapAge, setMapAge] = useState<string>('');
	const [mapDistance, setMapDistance] = useState<string>('');
	const [mapBib, setMapBib] = useState<string>('');

	const [importErr, setImportErr] = useState('');
	const [importing, setImporting] = useState(false);

	// filas rechazadas en la importación
	const [failedRows, setFailedRows] = useState<FailedImportRow[]>([]);

	const fileInputRef = useRef<HTMLInputElement | null>(null);

	// FORMULARIOS INDIVIDUALES (CREAR / EDITAR)
	const [showEditModal, setShowEditModal] = useState(false);
	const [editMode, setEditMode] = useState<'new' | 'edit'>('new');
	const [editId, setEditId] = useState<number | null>(null);

	const [formFirstName, setFormFirstName] = useState('');
	const [formLastName, setFormLastName] = useState('');
	const [formDni, setFormDni] = useState('');
	const [formSex, setFormSex] = useState('M');
	const [formBirthDate, setFormBirthDate] = useState('');
	const [formAge, setFormAge] = useState('');
	const [formDistance, setFormDistance] = useState('');
	const [formBib, setFormBib] = useState('');

	const [formErr, setFormErr] = useState('');
	const [savingForm, setSavingForm] = useState(false);

	// -------- LOAD DATA (carrera + participantes) --------
	async function loadData() {
		setLoading(true);

		// Carrera
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

		// Participantes
		const { data: partData, error: partErr } = await supabase
			.from('participants')
			.select(
				`
        id,
        bib_number,
        chip,
        first_name,
        last_name,
        dni,
        sex,
        birth_date,
        age,
        distance_km,
        category_id
      `
			)
			.eq('race_id', raceId)
			.order('bib_number', { ascending: true })
			.order('last_name', { ascending: true });

		if (partErr) {
			console.error('Error cargando participantes:', partErr);
			setParticipants([]);
			setExistingDnis(new Set());
		} else {
			const list = (partData || []) as ParticipantRow[];
			setParticipants(list);

			// cache DNIs
			const dset = new Set<string>();
			for (const p of list) {
				if (p.dni && p.dni.trim()) {
					dset.add(p.dni.trim());
				}
			}
			setExistingDnis(dset);
		}

		// limpiar estado importador/form
		setImportErr('');
		setImportStep('idle');
		setRawHeaders([]);
		setRawRows([]);
		setMapFirstName('');
		setMapLastName('');
		setMapDni('');
		setMapSex('');
		setMapBirthDate('');
		setMapAge('');
		setMapDistance('');
		setMapBib('');
		setFailedRows([]);

		setFormErr('');
		setSavingForm(false);

		setLoading(false);
	}

	useEffect(() => {
		loadData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [raceId]);

	// -------- KPI --------

	const totalCount = useMemo(() => participants.length, [participants]);

	const countByDistance = useMemo(() => {
		const acc: Record<string, number> = {};
		for (const p of participants) {
			const k = p.distance_km != null ? String(p.distance_km) : 'SIN_DIST';
			acc[k] = (acc[k] || 0) + 1;
		}
		return acc;
	}, [participants]);

	const countBySex = useMemo(() => {
		const acc: Record<string, number> = {};
		for (const p of participants) {
			const k = p.sex || 'SIN_SEXO';
			acc[k] = (acc[k] || 0) + 1;
		}
		return acc;
	}, [participants]);

	// -------- FILTRADO POR BUSCADOR EN LA TABLA --------
	const filteredParticipants = useMemo(() => {
		const q = searchQ.trim().toLowerCase();
		if (!q) return participants;
		return participants.filter((p) => {
			const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
			const doc = (p.dni || '').toLowerCase();
			return (
				fullName.includes(q) ||
				p.first_name.toLowerCase().includes(q) ||
				p.last_name.toLowerCase().includes(q) ||
				doc.includes(q)
			);
		});
	}, [participants, searchQ]);

	// ============================================================
	//                 IMPORTADOR MASIVO
	// ============================================================

	async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
		setImportErr('');
		const file = e.target.files?.[0];
		if (!file) return;

		const nameLower = file.name.toLowerCase();
		if (nameLower.endsWith('.csv')) {
			Papa.parse<Record<string, any>>(file, {
				header: true,
				skipEmptyLines: true,
				complete: (results) => {
					const rows = results.data;
					if (!rows || rows.length === 0) {
						setImportErr('El archivo está vacío o no se pudo leer.');
						return;
					}
					const headers = Object.keys(rows[0]);
					setRawHeaders(headers);
					setRawRows(rows);
					setImportStep('mapped');
				},
				error: (err) => {
					console.error('Error Papa:', err);
					setImportErr('No se pudo leer el CSV.');
				},
			});
		} else if (nameLower.endsWith('.xls') || nameLower.endsWith('.xlsx')) {
			const data = await file.arrayBuffer();
			const workbook = XLSX.read(data, { type: 'array' });
			const firstSheet = workbook.SheetNames[0];
			const sheet = workbook.Sheets[firstSheet];

			const jsonRows: any[] = XLSX.utils.sheet_to_json(sheet, { raw: false });

			if (!jsonRows || jsonRows.length === 0) {
				setImportErr('El archivo está vacío o no se pudo leer.');
				return;
			}

			const headers = Object.keys(jsonRows[0]);
			setRawHeaders(headers);
			setRawRows(jsonRows);
			setImportStep('mapped');
		} else {
			setImportErr('Formato no soportado. Usá CSV o Excel (.xlsx).');
		}
	}

	function validateMappingAndPrepare() {
		setImportErr('');

		if (
			!mapFirstName ||
			!mapLastName ||
			!mapDni ||
			!mapSex ||
			!mapDistance ||
			!mapBib
		) {
			setImportErr(
				'Faltan columnas obligatorias. Necesitamos Nombre, Apellido, DNI, Sexo, Distancia y Dorsal.'
			);
			return;
		}

		setImportStep('ready');
	}

	async function handleImportToSupabase() {
		if (!race) {
			setImportErr('No hay carrera cargada.');
			return;
		}
		if (importStep !== 'ready') {
			setImportErr('El mapeo no está listo.');
			return;
		}

		setImporting(true);
		setImportErr('');
		setFailedRows([]);

		const newFailed: FailedImportRow[] = [];
		let successCount = 0;

		// para DNIs duplicados dentro del archivo
		const seenThisBatch = new Set<string>();

		for (const row of rawRows) {
			// 1. Obtenemos crudo
			const rawFirstName = row[mapFirstName];
			const rawLastName = row[mapLastName];
			const rawDni = row[mapDni];
			const rawSex = row[mapSex];
			const rawDistance = row[mapDistance];
			const rawBib = row[mapBib];
			const rawBirth = mapBirthDate ? row[mapBirthDate] : null;
			const rawAge = mapAge ? row[mapAge] : null;

			// 2. Limpiamos
			const firstNameTrim = cleanName(rawFirstName);
			const lastNameTrim = cleanName(rawLastName);

			const dniClean = cleanDigits(rawDni);
			const normSex = normalizeSex(rawSex);

			const distanceSanitized = sanitizeDistanceRaw(rawDistance);
			const distNum = extractNumberLike(distanceSanitized);

			const bibDigits = cleanDigits(rawBib);
			const bibNum = bibDigits && bibDigits !== '' ? Number(bibDigits) : null;

			const birthISO = normalizeDate(rawBirth);
			const finalAge = deriveAge(birthISO, cleanDigits(rawAge));

			// 3. Validación dura
			if (!firstNameTrim || !lastNameTrim) {
				newFailed.push({
					rowData: row,
					errorMsg: 'Nombre o apellido vacío luego de limpiar espacios.',
				});
				continue;
			}

			if (!dniClean) {
				newFailed.push({
					rowData: row,
					errorMsg:
						'DNI vacío/ inválido. Debe ser sólo números, sin puntos/comas.',
				});
				continue;
			}

			if (existingDnis.has(dniClean)) {
				newFailed.push({
					rowData: row,
					errorMsg: `DNI duplicado con la base existente (${dniClean}).`,
				});
				continue;
			}
			if (seenThisBatch.has(dniClean)) {
				newFailed.push({
					rowData: row,
					errorMsg: `DNI repetido dentro del archivo (${dniClean}).`,
				});
				continue;
			}
			seenThisBatch.add(dniClean);

			if (!normSex) {
				newFailed.push({
					rowData: row,
					errorMsg: 'Sexo vacío/no reconocido. Debe mapear a M/F/X/ALL.',
				});
				continue;
			}

			if (distNum === null) {
				newFailed.push({
					rowData: row,
					errorMsg: 'Distancia inválida. Debe ser número (10, 21, etc.).',
				});
				continue;
			}

			if (bibNum === null || !Number.isFinite(bibNum)) {
				newFailed.push({
					rowData: row,
					errorMsg: 'Dorsal inválido. Sólo números, sin puntos ni comas.',
				});
				continue;
			}

			const chipVal = makeChipFromBibNumberString(bibDigits);
			if (!chipVal) {
				newFailed.push({
					rowData: row,
					errorMsg: 'Dorsal inválido para chip (máx 5 dígitos).',
				});
				continue;
			}

			// 4. Construimos fila a insertar
			const insertRow: any = {
				race_id: race.id,
				first_name: firstNameTrim,
				last_name: lastNameTrim,
				dni: dniClean,
				sex: normSex,
				birth_date: birthISO,
				age: finalAge,
				distance_km: distNum,
				bib_number: bibNum,
				chip: chipVal,
				category_id: null,
				age_snapshot: finalAge ?? null,
			};

			// 5. Insert
			const { error: insErr } = await supabase
				.from('participants')
				.insert([insertRow]);

			if (insErr) {
				console.error('Fila falló:', insErr, insertRow);
				newFailed.push({
					rowData: insertRow,
					errorMsg:
						insErr.message ||
						'Supabase rechazó esta fila (constraint / formato).',
				});
			} else {
				successCount++;
				existingDnis.add(dniClean);
			}
		}

		setFailedRows(newFailed);

		if (successCount === 0 && newFailed.length > 0) {
			setImportErr(
				'Ningún participante fue importado. Revisá las exclusiones listadas abajo.'
			);
		} else if (successCount > 0 && newFailed.length > 0) {
			setImportErr(
				`Se importaron ${successCount} participante(s). ${newFailed.length} fueron EXCLUIDOS (ver abajo).`
			);
		} else {
			setImportErr(
				`Se importaron ${successCount} participante(s) correctamente.`
			);
		}

		setImporting(false);
		loadData();
	}

	// ============================================================
	//          FORMULARIO INDIVIDUAL (ALTA / EDICIÓN)
	// ============================================================

	function openNewParticipant() {
		setEditMode('new');
		setEditId(null);
		setFormFirstName('');
		setFormLastName('');
		setFormDni('');
		setFormSex('M');
		setFormBirthDate('');
		setFormAge('');
		setFormDistance('');
		setFormBib('');
		setFormErr('');
		setShowEditModal(true);
	}

	function openEditParticipant(p: ParticipantRow) {
		setEditMode('edit');
		setEditId(p.id);
		setFormFirstName(p.first_name || '');
		setFormLastName(p.last_name || '');
		setFormDni(p.dni || '');
		setFormSex(p.sex || 'M');
		setFormBirthDate(p.birth_date || '');
		setFormAge(p.age != null ? String(p.age) : '');
		setFormDistance(p.distance_km != null ? String(p.distance_km) : '');
		setFormBib(p.bib_number != null ? String(p.bib_number) : '');
		setFormErr('');
		setShowEditModal(true);
	}

	async function saveParticipantForm() {
		if (!race) return;
		setSavingForm(true);
		setFormErr('');

		// limpiamos con las mismas reglas
		const firstNameTrim = cleanName(formFirstName);
		const lastNameTrim = cleanName(formLastName);

		const dniClean = cleanDigits(formDni);
		const normSex = normalizeSex(formSex);
		const distanceSanitized = sanitizeDistanceRaw(formDistance);
		const distNum = extractNumberLike(distanceSanitized);
		const bibDigits = cleanDigits(formBib);
		const bibNum = bibDigits && bibDigits !== '' ? Number(bibDigits) : null;
		const birthISO = normalizeDate(formBirthDate || null);
		const finalAge = deriveAge(birthISO, cleanDigits(formAge));
		const chipVal = bibDigits ? makeChipFromBibNumberString(bibDigits) : null;

		if (!firstNameTrim || !lastNameTrim) {
			setFormErr('Nombre y Apellido son obligatorios.');
			setSavingForm(false);
			return;
		}

		if (!dniClean) {
			setFormErr('DNI es obligatorio.');
			setSavingForm(false);
			return;
		}

		if (!normSex) {
			setFormErr('Sexo es obligatorio (M/F/X/ALL).');
			setSavingForm(false);
			return;
		}

		if (distNum === null) {
			setFormErr('Distancia inválida.');
			setSavingForm(false);
			return;
		}

		if (bibNum === null || !Number.isFinite(bibNum)) {
			setFormErr('Dorsal inválido.');
			setSavingForm(false);
			return;
		}

		if (!chipVal) {
			setFormErr('No pude generar chip (dorsal muy largo?).');
			setSavingForm(false);
			return;
		}

		// chequeo dni duplicado si es alta nueva
		if (editMode === 'new') {
			if (existingDnis.has(dniClean)) {
				setFormErr('Ya existe un corredor con ese DNI.');
				setSavingForm(false);
				return;
			}
		} else {
			// modo edición, si cambiaste el DNI hay que ver si no choca con otro
			// vamos a preguntar a supabase
			const { data: otherDni } = await supabase
				.from('participants')
				.select('id,dni')
				.eq('race_id', race.id)
				.eq('dni', dniClean);

			if (
				otherDni &&
				otherDni.length > 0 &&
				otherDni.some((r: any) => r.id !== editId)
			) {
				setFormErr('Ese DNI ya está asignado a otro participante.');
				setSavingForm(false);
				return;
			}
		}

		const rowToSave: any = {
			race_id: race.id,
			first_name: firstNameTrim,
			last_name: lastNameTrim,
			dni: dniClean,
			sex: normSex,
			birth_date: birthISO,
			age: finalAge,
			distance_km: distNum,
			bib_number: bibNum,
			chip: chipVal,
			age_snapshot: finalAge ?? null,
		};

		let saveErr;
		if (editMode === 'new') {
			const { error } = await supabase.from('participants').insert([rowToSave]);
			saveErr = error || null;
		} else {
			const { error } = await supabase
				.from('participants')
				.update(rowToSave)
				.eq('id', editId)
				.eq('race_id', race.id);
			saveErr = error || null;
		}

		if (saveErr) {
			console.error(saveErr);
			setFormErr(
				saveErr.message || 'No se pudo guardar el participante en la base.'
			);
			setSavingForm(false);
			return;
		}

		setShowEditModal(false);
		setSavingForm(false);
		loadData();
	}

	async function deleteParticipant(p: ParticipantRow) {
		if (!race) return;
		const ok = window.confirm(
			`Vas a borrar a ${p.first_name} ${p.last_name} (#${p.bib_number}). ¿Confirmás?`
		);
		if (!ok) return;

		const { error } = await supabase
			.from('participants')
			.delete()
			.eq('id', p.id)
			.eq('race_id', race.id);

		if (error) {
			console.error(error);
			alert('No se pudo borrar.');
			return;
		}

		loadData();
	}

	// ============================================================
	//          ASIGNACIÓN AUTOMÁTICA DE CATEGORÍAS
	// ============================================================

	async function handleAssignCategories() {
		if (!race) return;

		// 1. Traer categorías activas de la carrera
		const { data: cats, error: catErr } = await supabase
			.from('categories')
			.select(
				'id,race_id,name,distance_km,sex_filter,age_min,age_max,is_active'
			)
			.eq('race_id', race.id)
			.eq('is_active', true);

		if (catErr) {
			console.error(catErr);
			alert('No pude cargar categorías activas.');
			return;
		}

		const categories = (cats || []) as CategoryRow[];

		// 2. Para cada participante local, decidir su categoría
		for (const p of participants) {
			if (
				p.distance_km == null ||
				!p.sex ||
				(p.age == null && p.birth_date == null)
			) {
				// no tenemos la data necesaria, lo salteamos
				continue;
			}

			// edad efectiva: usamos p.age
			const effectiveAge = p.age;

			// buscamos todas las categorías que matcheen
			const matching = categories.filter((c) => {
				// distancia igual
				if (c.distance_km == null) return false;
				if (p.distance_km === null) return false;
				if (Number(c.distance_km) !== Number(p.distance_km)) return false;

				// sexo compatible
				if (c.sex_filter !== 'ALL' && c.sex_filter !== p.sex) return false;

				// edad dentro del rango
				if (effectiveAge == null) return false;
				if (c.age_min != null && effectiveAge < c.age_min) return false;
				if (c.age_max != null && effectiveAge > c.age_max) return false;

				return true;
			});

			if (matching.length === 0) {
				// no hay match -> no tocamos category_id
				continue;
			}

			// si hay varias, elegimos la "más específica":
			// menor rango de edad (age_max-age_min)
			let chosen = matching[0];
			let chosenSpan = spanOf(chosen);
			for (let i = 1; i < matching.length; i++) {
				const s = spanOf(matching[i]);
				if (s < chosenSpan) {
					chosen = matching[i];
					chosenSpan = s;
				}
			}

			if (p.category_id !== chosen.id) {
				// update en supabase
				await supabase
					.from('participants')
					.update({ category_id: chosen.id })
					.eq('id', p.id)
					.eq('race_id', race.id);
			}
		}

		// refrescamos la data
		loadData();

		function spanOf(c: CategoryRow) {
			const min = c.age_min ?? 0;
			const max = c.age_max ?? 200;
			return max - min;
		}
	}

	// ============================================================
	// RENDER
	// ============================================================

	if (loading && !race) {
		return (
			<main className='min-h-screen bg-neutral-950 text-white p-4'>
				<div className='text-neutral-400 text-sm'>
					Cargando participantes...
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
					<span>Participantes</span>
				</div>

				<div className='min-w-0'>
					<h1 className='text-2xl font-bold leading-tight break-words'>
						Gestión de participantes
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

			{/* KPI + acciones */}
			<div className='grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6'>
				<div className='rounded-xl border border-neutral-700 bg-neutral-900 p-4 flex flex-col col-span-1'>
					<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
						Total inscritos
					</div>
					<div className='text-3xl font-bold text-white leading-none'>
						{totalCount}
					</div>
					<div className='text-[10px] text-neutral-500 mt-1'>
						Corredores cargados
					</div>
				</div>

				<div className='rounded-xl border border-neutral-700 bg-neutral-900 p-4 flex flex-col col-span-1'>
					<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
						Por distancia
					</div>
					<div className='text-[12px] text-neutral-200 leading-tight flex flex-col gap-1 mt-2'>
						{Object.keys(countByDistance).length === 0 ? (
							<div className='text-neutral-500 text-[11px]'>Sin datos</div>
						) : (
							Object.entries(countByDistance).map(([dist, cnt]) => (
								<div key={dist} className='flex justify-between text-[12px]'>
									<span className='text-neutral-400'>
										{dist === 'SIN_DIST' ? '— km' : `${dist}K`}
									</span>
									<span className='text-white font-semibold'>{cnt}</span>
								</div>
							))
						)}
					</div>
					<div className='text-[10px] text-neutral-500 mt-2'>
						distance_km asignada
					</div>
				</div>

				<div className='rounded-xl border border-neutral-700 bg-neutral-900 p-4 flex flex-col col-span-1'>
					<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
						Por sexo
					</div>
					<div className='text-[12px] text-neutral-200 leading-tight flex flex-col gap-1 mt-2'>
						{Object.keys(countBySex).length === 0 ? (
							<div className='text-neutral-500 text-[11px]'>Sin datos</div>
						) : (
							Object.entries(countBySex).map(([sx, cnt]) => (
								<div key={sx} className='flex justify-between text-[12px]'>
									<span className='text-neutral-400'>
										{sx === 'SIN_SEXO' ? '—' : sx}
									</span>
									<span className='text-white font-semibold'>{cnt}</span>
								</div>
							))
						)}
					</div>
					<div className='text-[10px] text-neutral-500 mt-2'>
						M / F / X / ALL
					</div>
				</div>

				<div className='rounded-xl border border-neutral-700 bg-neutral-900 p-4 flex flex-col justify-between col-span-1'>
					<div>
						<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
							Acciones rápidas
						</div>
						<div className='text-[10px] text-neutral-500 leading-tight mt-1'>
							Asignar categoría por reglas (edad, sexo, distancia)
						</div>
					</div>
					<button
						className='mt-3 w-full bg-blue-600 text-white font-semibold text-xs px-3 py-2 rounded-lg active:scale-95'
						onClick={handleAssignCategories}
					>
						Recalcular categorías
					</button>
				</div>
			</div>

			{/* BUSCADOR + BOTONES */}
			<div className='border border-neutral-700 bg-neutral-900 rounded-xl p-4 mb-6 flex flex-col gap-4'>
				<div className='flex flex-col sm:flex-row sm:items-end gap-4'>
					<div className='flex-1'>
						<label className='text-sm text-neutral-300'>
							Buscar participante
						</label>
						<input
							className='w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm mt-1'
							placeholder='Apellido, nombre o DNI'
							value={searchQ}
							onChange={(e) => setSearchQ(e.target.value)}
						/>
						<div className='text-[10px] text-neutral-500 mt-1'>
							Filtra la tabla de abajo. Cliente en vivo, no llama a la base.
						</div>
					</div>

					<div className='flex flex-col gap-2 w-full sm:w-auto'>
						<button
							className='bg-emerald-600 text-white font-semibold text-sm px-4 py-2 rounded-lg active:scale-95'
							onClick={openNewParticipant}
						>
							+ Nuevo participante
						</button>

						<div className='text-[10px] text-neutral-500 text-center sm:text-left'>
							Alta manual / cargar 1 corredor
						</div>
					</div>
				</div>

				{/* IMPORTADOR MASIVO */}
				<div className='flex flex-col gap-3 border border-neutral-700 rounded-lg p-3 bg-neutral-800/30'>
					<div className='flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3'>
						<div className='flex flex-col gap-1'>
							<div className='text-neutral-300 text-sm font-semibold'>
								Importar desde Excel / CSV
							</div>
							<div className='text-[11px] text-neutral-400 leading-tight'>
								Obligatorio por fila: Nombre, Apellido, DNI, Sexo, Distancia,
								Dorsal. El DNI no se puede repetir. Generamos el chip
								automáticamente.
							</div>
						</div>

						<div className='shrink-0'>
							<input
								ref={fileInputRef}
								type='file'
								accept='.csv, .xls, .xlsx'
								className='text-[11px] text-neutral-300 file:bg-neutral-800 file:border file:border-neutral-600 file:rounded-lg file:px-2 file:py-1 file:text-[11px] file:text-neutral-200 file:mr-2 file:cursor-pointer'
								onChange={handleFile}
							/>
						</div>
					</div>

					{importErr && (
						<div className='text-sm font-medium text-neutral-200 bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2'>
							{importErr}
						</div>
					)}

					{/* Paso mapeo */}
					{importStep !== 'idle' && (
						<div className='border border-neutral-700 rounded-lg p-3 bg-neutral-900 flex flex-col gap-3'>
							<div className='text-white text-sm font-semibold'>
								Mapeo de columnas
							</div>
							<div className='text-[11px] text-neutral-400 leading-tight'>
								DNI sin puntos/comas/espacios. Distancia sólo número. Dorsal
								sólo número. Si hay Edad o Fecha nac., calculamos edad.
							</div>

							<div className='grid grid-cols-2 gap-3 text-[13px] text-white'>
								<SelectMap
									label='Nombre *'
									value={mapFirstName}
									setValue={setMapFirstName}
									headers={rawHeaders}
								/>
								<SelectMap
									label='Apellido *'
									value={mapLastName}
									setValue={setMapLastName}
									headers={rawHeaders}
								/>
								<SelectMap
									label='DNI *'
									value={mapDni}
									setValue={setMapDni}
									headers={rawHeaders}
									hint='Se limpia: sólo dígitos'
								/>
								<SelectMap
									label='Sexo *'
									value={mapSex}
									setValue={setMapSex}
									headers={rawHeaders}
									hint='M / F / X / ALL'
								/>
								<SelectMap
									label='Fecha nacimiento'
									value={mapBirthDate}
									setValue={setMapBirthDate}
									headers={rawHeaders}
								/>
								<SelectMap
									label='Edad'
									value={mapAge}
									setValue={setMapAge}
									headers={rawHeaders}
									hint='Sólo número'
								/>
								<SelectMap
									label='Distancia (km) *'
									value={mapDistance}
									setValue={setMapDistance}
									headers={rawHeaders}
									hint='Ej: "21", "21K", "21 km"'
								/>
								<SelectMap
									label='Dorsal *'
									value={mapBib}
									setValue={setMapBib}
									headers={rawHeaders}
									hint='Sólo número'
								/>
							</div>

							{importStep === 'mapped' && (
								<button
									className='w-full bg-blue-600 text-white font-semibold text-base px-4 py-3 rounded-lg active:scale-95'
									onClick={validateMappingAndPrepare}
								>
									Validar mapeo
								</button>
							)}

							{importStep === 'ready' && (
								<button
									className='w-full bg-emerald-600 text-white font-semibold text-base px-4 py-3 rounded-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100'
									disabled={importing}
									onClick={handleImportToSupabase}
								>
									{importing ? 'Importando...' : 'Importar a la carrera'}
								</button>
							)}
						</div>
					)}

					{/* Filas excluidas */}
					{failedRows.length > 0 && (
						<div className='border border-red-700 bg-red-950/30 rounded-lg p-3 flex flex-col gap-2'>
							<div className='text-red-400 text-sm font-semibold'>
								Participantes EXCLUIDOS ({failedRows.length})
							</div>
							<div className='text-[11px] text-red-300 leading-tight'>
								Estas filas NO se cargaron. Motivo a la vista (DNI duplicado,
								distancia inválida, dorsal mal formateado, etc.). Corregí y
								reintentá sólo con ellos.
							</div>

							<div className='max-h-48 overflow-y-auto text-[11px] text-neutral-200 bg-neutral-900 border border-neutral-700 rounded p-2'>
								{failedRows.map((f, idx) => (
									<div
										key={idx}
										className='border-b border-neutral-700 pb-2 mb-2 last:mb-0 last:pb-0 last:border-b-0'
									>
										<div className='text-red-400 font-semibold'>
											{f.errorMsg}
										</div>
										<div className='text-neutral-400 break-words'>
											{JSON.stringify(f.rowData)}
										</div>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</div>

			{/* LISTADO PARTICIPANTES */}
			<div className='border border-neutral-700 bg-neutral-900 rounded-xl overflow-hidden'>
				<div className='overflow-x-auto'>
					<table className='min-w-full text-left text-sm text-neutral-200'>
						<thead className='bg-neutral-800 text-[11px] uppercase text-neutral-400'>
							<tr>
								<th className='px-3 py-2 whitespace-nowrap'>Dorsal</th>
								<th className='px-3 py-2 whitespace-nowrap'>Chip</th>
								<th className='px-3 py-2 whitespace-nowrap'>Nombre</th>
								<th className='px-3 py-2 whitespace-nowrap'>DNI</th>
								<th className='px-3 py-2 whitespace-nowrap'>Sexo</th>
								<th className='px-3 py-2 whitespace-nowrap'>Edad</th>
								<th className='px-3 py-2 whitespace-nowrap'>Dist</th>
								<th className='px-3 py-2 whitespace-nowrap text-right'>
									Acciones
								</th>
							</tr>
						</thead>
						<tbody>
							{filteredParticipants.length === 0 ? (
								<tr>
									<td
										colSpan={8}
										className='px-3 py-4 text-center text-neutral-500 text-[12px]'
									>
										Sin participantes para este filtro.
									</td>
								</tr>
							) : (
								filteredParticipants.map((p, idx) => (
									<tr
										key={p.id}
										className={
											idx % 2 === 0 ? 'bg-neutral-900' : 'bg-neutral-950/40'
										}
									>
										<td className='px-3 py-2 text-white font-semibold text-[13px]'>
											{p.bib_number != null ? `#${p.bib_number}` : '—'}
										</td>

										<td className='px-3 py-2 text-[13px] text-neutral-300 font-mono'>
											{p.chip || '—'}
										</td>

										<td className='px-3 py-2'>
											<div className='text-white text-[13px] font-semibold leading-tight'>
												{p.first_name} {p.last_name}
											</div>
											<div className='text-[10px] text-neutral-500 leading-tight'>
												{p.birth_date
													? `Nac: ${p.birth_date}`
													: p.age != null
													? `Edad: ${p.age}`
													: ''}
											</div>
										</td>

										<td className='px-3 py-2 text-[13px] text-neutral-300'>
											{p.dni ?? '—'}
										</td>

										<td className='px-3 py-2 text-[13px] text-neutral-300'>
											{p.sex || '—'}
										</td>

										<td className='px-3 py-2 text-[13px] text-neutral-300'>
											{p.age != null ? p.age : '—'}
										</td>

										<td className='px-3 py-2 text-[13px] text-neutral-300'>
											{p.distance_km != null ? `${p.distance_km}K` : '—'}
										</td>

										<td className='px-3 py-2 text-right text-[13px] text-neutral-300'>
											<button
												className='text-emerald-400 underline text-[12px] mr-3'
												onClick={() => openEditParticipant(p)}
											>
												Editar
											</button>
											<button
												className='text-red-400 underline text-[12px]'
												onClick={() => deleteParticipant(p)}
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
					Estos datos son los guardados en Supabase. Si corregís algo manual,
					guardá y luego podés volver a “Recalcular categorías”.
				</div>
			</div>

			{/* MODAL ALTA / EDICIÓN */}
			{showEditModal && (
				<div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'>
					<div className='w-full max-w-md bg-neutral-900 border border-neutral-700 rounded-2xl p-4 text-white'>
						<div className='flex items-start justify-between mb-3'>
							<div>
								<div className='text-lg font-semibold'>
									{editMode === 'new'
										? 'Nuevo participante'
										: 'Editar participante'}
								</div>
								<div className='text-[11px] text-neutral-500 leading-tight'>
									Obligatorios: Nombre, Apellido, DNI, Sexo, Distancia, Dorsal.
								</div>
							</div>
							<button
								className='text-neutral-400 text-sm'
								onClick={() => {
									if (!savingForm) setShowEditModal(false);
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
							<FieldEdit
								label='Nombre *'
								value={formFirstName}
								onChange={setFormFirstName}
							/>
							<FieldEdit
								label='Apellido *'
								value={formLastName}
								onChange={setFormLastName}
							/>
							<FieldEdit
								label='DNI *'
								value={formDni}
								onChange={setFormDni}
								hint='Sólo dígitos'
							/>
							<div className='flex flex-col'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Sexo *
								</div>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={formSex}
									onChange={(e) => setFormSex(e.target.value)}
								>
									<option value='M'>M</option>
									<option value='F'>F</option>
									<option value='X'>X</option>
									<option value='ALL'>ALL</option>
								</select>
								<div className='text-[10px] text-neutral-500 mt-1'>
									Usado también para categorías
								</div>
							</div>

							<FieldEdit
								label='Fecha nac.'
								value={formBirthDate}
								onChange={setFormBirthDate}
								hint='DD/MM/AAAA o AAAA-MM-DD'
							/>
							<FieldEdit
								label='Edad'
								value={formAge}
								onChange={setFormAge}
								hint='Sólo número'
							/>
							<FieldEdit
								label='Distancia (km) *'
								value={formDistance}
								onChange={setFormDistance}
								hint='Ej: "21" ó "21K"'
							/>
							<FieldEdit
								label='Dorsal *'
								value={formBib}
								onChange={setFormBib}
								hint='Sólo número'
							/>
						</div>

						<div className='flex flex-col sm:flex-row-reverse sm:justify-end gap-3 mt-4'>
							<button
								className='bg-emerald-600 text-white font-semibold text-sm px-4 py-2 rounded-lg active:scale-95 disabled:opacity-50'
								disabled={savingForm}
								onClick={saveParticipantForm}
							>
								{savingForm ? 'Guardando...' : 'Guardar'}
							</button>
							<button
								className='bg-neutral-800 text-white border border-neutral-600 font-semibold text-sm px-4 py-2 rounded-lg active:scale-95 disabled:opacity-50'
								disabled={savingForm}
								onClick={() => setShowEditModal(false)}
							>
								Cancelar
							</button>
						</div>

						<div className='text-[10px] text-neutral-600 mt-3 leading-tight'>
							Al guardar, se actualiza la tabla. Después podés ejecutar
							“Recalcular categorías” para que el sistema le asigne la categoría
							correcta según edad / distancia / sexo.
						</div>
					</div>
				</div>
			)}

			{/* ROADMAP */}
			<div className='mt-8 text-[11px] text-neutral-500 leading-relaxed border-t border-neutral-800 pt-4'>
				<div className='mb-2 font-medium text-neutral-300 text-[12px]'>
					Roadmap:
				</div>
				<ol className='list-decimal list-inside space-y-1'>
					<li>
						Bloqueo por rol (si no sos admin, no podés ni ver esta pantalla).
					</li>
					<li>
						Exportar XLSX de clasificaciones por categoría y distancia directo
						desde la app.
					</li>
				</ol>
			</div>
		</main>
	);
}

// ============ SUBCOMPONENTES PEQUEÑOS ============

function SelectMap({
	label,
	value,
	setValue,
	headers,
	hint,
}: {
	label: string;
	value: string;
	setValue: (v: string) => void;
	headers: string[];
	hint?: string;
}) {
	return (
		<label className='flex flex-col gap-1'>
			<span className='text-white'>{label}</span>
			<select
				className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2'
				value={value}
				onChange={(e) => setValue(e.target.value)}
			>
				<option value=''>-- Elegir --</option>
				{headers.map((h) => (
					<option key={h} value={h}>
						{h}
					</option>
				))}
			</select>
			{hint && (
				<div className='text-[10px] text-neutral-500 leading-tight'>{hint}</div>
			)}
		</label>
	);
}

function FieldEdit({
	label,
	value,
	onChange,
	hint,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	hint?: string;
}) {
	return (
		<div className='flex flex-col'>
			<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
				{label}
			</div>
			<input
				className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
				value={value}
				onChange={(e) => onChange(e.target.value)}
			/>
			{hint && <div className='text-[10px] text-neutral-500 mt-1'>{hint}</div>}
		</div>
	);
}
