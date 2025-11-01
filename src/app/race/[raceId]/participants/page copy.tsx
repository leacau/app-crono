'use client';

import * as Papa from 'papaparse';
import * as XLSX from 'xlsx';

import { use, useEffect, useMemo, useRef, useState } from 'react';

import { supabase } from '../../../../lib/supabaseClient';
import { useRouter } from 'next/navigation';

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
	rowData: any; // fila que intentamos subir (ya normalizada)
	errorMsg: string; // motivo concreto
};

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

	// Participantes ya cargados
	const [participants, setParticipants] = useState<ParticipantRow[]>([]);
	const [loading, setLoading] = useState(true);

	// Para validar DNI único
	const [existingDnis, setExistingDnis] = useState<Set<string>>(new Set());

	// IMPORTACIÓN MASIVA
	const [rawHeaders, setRawHeaders] = useState<string[]>([]);
	const [rawRows, setRawRows] = useState<Record<string, any>[]>([]);
	const [importStep, setImportStep] = useState<'idle' | 'mapped' | 'ready'>(
		'idle'
	);

	// mapping columnas -> campos internos
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

	// filas rechazadas durante la importación fila-a-fila
	const [failedRows, setFailedRows] = useState<FailedImportRow[]>([]);

	const fileInputRef = useRef<HTMLInputElement | null>(null);

	// ============================================================
	// Helpers de normalización
	// ============================================================

	// Número dentro de strings tipo "10K", "21 km", "5,5"
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

	// Edad tipo "38", "38 años"
	function extractAge(v: any): number | null {
		if (v === undefined || v === null) return null;
		const s = String(v).trim();
		if (!s) return null;
		const m = s.match(/(\d{1,3})/);
		if (!m) return null;
		const n = Number(m[1]);
		if (!Number.isFinite(n)) return null;
		if (n < 0 || n > 120) return null;
		return n;
	}

	// Sexo → "M" | "F" | "X" | "ALL"
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

	// Calcula edad final.
	// Prioridad:
	// 1. Edad explícita en planilla.
	// 2. Calcular desde fecha de nacimiento.
	function deriveAge(birthISO: string | null, ageRaw: any): number | null {
		const direct = extractAge(ageRaw);
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

	// Formatear chip en base al dorsal.
	// Regla:
	//   chip = "LT" + dorsal padded a 5 dígitos
	//   dorsal=152 -> "LT00152"
	//   dorsal=7   -> "LT00007"
	//   Si dorsal tiene >5 dígitos => inválido
	function makeChipFromBib(bibNumber: number | null): string | null {
		if (bibNumber === null || bibNumber === undefined) return null;
		const raw = String(bibNumber).trim();
		if (!raw) return null;

		if (raw.length > 5) {
			// No permitimos bibs de más de 5 dígitos porque rompe la convención.
			return null;
		}

		const padded = raw.padStart(5, '0'); // completa con ceros adelante
		return 'LT' + padded;
	}

	// ============================================================
	// Carga inicial carrera + participantes + DNIs existentes
	// ============================================================

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

		// participantes
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

			// armamos set de DNIs ya usados (no null)
			const dset = new Set<string>();
			for (const p of list) {
				if (p.dni && p.dni.trim()) {
					dset.add(p.dni.trim());
				}
			}
			setExistingDnis(dset);
		}

		// reset importador
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

		setLoading(false);
	}

	useEffect(() => {
		loadData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [raceId]);

	// ============================================================
	// Métricas: total / por distancia / por sexo
	// ============================================================

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

	// ============================================================
	// 1) Usuario selecciona archivo
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

			const jsonRows: any[] = XLSX.utils.sheet_to_json(sheet, {
				raw: false,
			});

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

	// ============================================================
	// 2) Validar mapeo
	// ============================================================

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

		// Edad / fecha nac son opcionales.
		setImportStep('ready');
	}

	// ============================================================
	// 3) Import fila-a-fila con:
	//    - DNI único
	//    - Dorsal obligatorio + chip autogenerado
	//    - Si algo falla => va a failedRows
	// ============================================================

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

		// Para evitar DNIs repetidos dentro del mismo archivo
		const seenThisBatch = new Set<string>();

		for (const row of rawRows) {
			// Campos base
			const firstNameVal = row[mapFirstName];
			const lastNameVal = row[mapLastName];
			const dniRawVal = row[mapDni];
			const sexVal = row[mapSex];
			const distVal = row[mapDistance];
			const bibVal = row[mapBib];

			// Validaciones básicas
			if (
				firstNameVal === undefined ||
				lastNameVal === undefined ||
				dniRawVal === undefined ||
				sexVal === undefined ||
				distVal === undefined ||
				bibVal === undefined
			) {
				newFailed.push({
					rowData: row,
					errorMsg:
						'Faltan columnas básicas (Nombre, Apellido, DNI, Sexo, Distancia o Dorsal).',
				});
				continue;
			}

			const firstNameTrim = String(firstNameVal).trim();
			const lastNameTrim = String(lastNameVal).trim();
			const dniTrim = String(dniRawVal).trim();
			const normSex = normalizeSex(sexVal);
			const distNum = extractNumberLike(distVal);
			const bibNum = extractNumberLike(bibVal);

			if (!firstNameTrim || !lastNameTrim) {
				newFailed.push({
					rowData: row,
					errorMsg: 'Nombre o apellido vacío.',
				});
				continue;
			}

			if (!dniTrim) {
				newFailed.push({
					rowData: row,
					errorMsg: 'DNI vacío. Es obligatorio y debe ser único.',
				});
				continue;
			}

			if (existingDnis.has(dniTrim)) {
				newFailed.push({
					rowData: row,
					errorMsg: `DNI duplicado con la base existente (${dniTrim}).`,
				});
				continue;
			}
			if (seenThisBatch.has(dniTrim)) {
				newFailed.push({
					rowData: row,
					errorMsg: `DNI repetido dentro del archivo (${dniTrim}).`,
				});
				continue;
			}
			seenThisBatch.add(dniTrim);

			if (!normSex) {
				newFailed.push({
					rowData: row,
					errorMsg: 'Sexo vacío o ilegible.',
				});
				continue;
			}

			if (distNum === null) {
				newFailed.push({
					rowData: row,
					errorMsg: 'Distancia no reconocible.',
				});
				continue;
			}

			if (bibNum === null) {
				newFailed.push({
					rowData: row,
					errorMsg:
						'Dorsal vacío o ilegible. Es obligatorio para generar el chip.',
				});
				continue;
			}

			// Generar chip
			const chipVal = makeChipFromBib(bibNum);
			if (!chipVal) {
				newFailed.push({
					rowData: row,
					errorMsg:
						'Dorsal inválido para chip. Debe ser numérico y máx 5 dígitos.',
				});
				continue;
			}

			// Campos edad / fecha
			const birthRaw =
				mapBirthDate && row[mapBirthDate] !== undefined
					? row[mapBirthDate]
					: null;
			const ageRaw = mapAge && row[mapAge] !== undefined ? row[mapAge] : null;

			const birthISO = normalizeDate(birthRaw);
			const finalAge = deriveAge(birthISO, ageRaw);

			// Armamos la fila final para insertar
			const insertRow: any = {
				race_id: race.id,
				first_name: firstNameTrim,
				last_name: lastNameTrim,
				dni: dniTrim,
				sex: normSex,
				birth_date: birthISO,
				age: finalAge,
				distance_km: distNum,
				bib_number: bibNum,
				chip: chipVal, // <-- nuevo campo chip
				category_id: null,
				// Para compatibilidad con tu tabla si sigue existiendo age_snapshot:
				age_snapshot: finalAge ?? null,
			};

			// Insert individual
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
				// marcamos el DNI como usado ahora
				existingDnis.add(dniTrim);
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
		// refrescamos lista
		loadData();
	}

	// ============================================================
	// Render
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

			{/* DASHBOARD KPI */}
			<div className='grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6'>
				<div className='rounded-xl border border-neutral-700 bg-neutral-900 p-4 flex flex-col'>
					<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
						Total inscritos
					</div>
					<div className='text-3xl font-bold text-white leading-none'>
						{totalCount}
					</div>
					<div className='text-[10px] text-neutral-500 mt-1'>
						Todos los participantes cargados
					</div>
				</div>

				<div className='rounded-xl border border-neutral-700 bg-neutral-900 p-4 flex flex-col'>
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
						Distancia_km asignada
					</div>
				</div>

				<div className='rounded-xl border border-neutral-700 bg-neutral-900 p-4 flex flex-col'>
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
						Sexos normalizados (M / F / X / ALL)
					</div>
				</div>
			</div>

			{/* IMPORTADOR */}
			<div className='border border-neutral-700 bg-neutral-900 rounded-xl p-4 mb-6 flex flex-col gap-4'>
				<div className='flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3'>
					<div className='flex flex-col gap-1'>
						<div className='text-neutral-300 text-sm font-semibold'>
							Importar desde Excel / CSV
						</div>
						<div className='text-[11px] text-neutral-400 leading-tight'>
							Mapeá columnas y cargamos corredor por corredor. Obligatorio:
							Nombre, Apellido, DNI, Sexo, Distancia, Dorsal. Generamos el chip
							automáticamente (LT + dorsal con 0s). Si una fila queda afuera,
							vas a ver el motivo exacto.
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
					<div className='border border-neutral-700 rounded-lg p-3 bg-neutral-800/30 flex flex-col gap-3'>
						<div className='text-white text-sm font-semibold'>
							Mapeo de columnas
						</div>
						<div className='text-[11px] text-neutral-400 leading-tight'>
							DNI no puede repetirse. El dorsal se usa para crear el chip
							(LT00007, LT00152, etc.). Edad y fecha de nacimiento ayudan con
							categorías, pero no frenan la importación.
						</div>

						<div className='grid grid-cols-2 gap-3 text-[13px] text-white'>
							<label className='flex flex-col gap-1'>
								<span>Nombre *</span>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2'
									value={mapFirstName}
									onChange={(e) => setMapFirstName(e.target.value)}
								>
									<option value=''>-- Elegir --</option>
									{rawHeaders.map((h) => (
										<option key={h} value={h}>
											{h}
										</option>
									))}
								</select>
							</label>

							<label className='flex flex-col gap-1'>
								<span>Apellido *</span>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2'
									value={mapLastName}
									onChange={(e) => setMapLastName(e.target.value)}
								>
									<option value=''>-- Elegir --</option>
									{rawHeaders.map((h) => (
										<option key={h} value={h}>
											{h}
										</option>
									))}
								</select>
							</label>

							<label className='flex flex-col gap-1'>
								<span>DNI *</span>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2'
									value={mapDni}
									onChange={(e) => setMapDni(e.target.value)}
								>
									<option value=''>-- Elegir --</option>
									{rawHeaders.map((h) => (
										<option key={h} value={h}>
											{h}
										</option>
									))}
								</select>
								<div className='text-[10px] text-neutral-500 leading-tight'>
									Obligatorio. No puede repetirse.
								</div>
							</label>

							<label className='flex flex-col gap-1'>
								<span>Sexo *</span>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2'
									value={mapSex}
									onChange={(e) => setMapSex(e.target.value)}
								>
									<option value=''>-- Elegir --</option>
									{rawHeaders.map((h) => (
										<option key={h} value={h}>
											{h}
										</option>
									))}
								</select>
							</label>

							<label className='flex flex-col gap-1'>
								<span>Fecha de nacimiento</span>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2'
									value={mapBirthDate}
									onChange={(e) => setMapBirthDate(e.target.value)}
								>
									<option value=''>-- Ninguna --</option>
									{rawHeaders.map((h) => (
										<option key={h} value={h}>
											{h}
										</option>
									))}
								</select>
								<div className='text-[10px] text-neutral-500 leading-tight'>
									Soporta DD/MM/YYYY, YYYY-MM-DD, etc.
								</div>
							</label>

							<label className='flex flex-col gap-1'>
								<span>Edad</span>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2'
									value={mapAge}
									onChange={(e) => setMapAge(e.target.value)}
								>
									<option value=''>-- Ninguna --</option>
									{rawHeaders.map((h) => (
										<option key={h} value={h}>
											{h}
										</option>
									))}
								</select>
							</label>

							<label className='flex flex-col gap-1'>
								<span>Distancia (km) *</span>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2'
									value={mapDistance}
									onChange={(e) => setMapDistance(e.target.value)}
								>
									<option value=''>-- Elegir --</option>
									{rawHeaders.map((h) => (
										<option key={h} value={h}>
											{h}
										</option>
									))}
								</select>
								<div className='text-[10px] text-neutral-500 leading-tight'>
									Ej: 5 / 10K / 21 km
								</div>
							</label>

							<label className='flex flex-col gap-1'>
								<span>Dorsal *</span>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2'
									value={mapBib}
									onChange={(e) => setMapBib(e.target.value)}
								>
									<option value=''>-- Elegir --</option>
									{rawHeaders.map((h) => (
										<option key={h} value={h}>
											{h}
										</option>
									))}
								</select>
								<div className='text-[10px] text-neutral-500 leading-tight'>
									Usamos esto para generar el chip (LT + 000xx).
								</div>
							</label>
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
							Estas filas NO se cargaron. Motivo a la vista: DNI repetido,
							dorsal inválido, etc. Corregí y reintentá.
						</div>

						<div className='max-h-48 overflow-y-auto text-[11px] text-neutral-200 bg-neutral-900 border border-neutral-700 rounded p-2'>
							{failedRows.map((f, idx) => (
								<div
									key={idx}
									className='border-b border-neutral-700 pb-2 mb-2 last:mb-0 last:pb-0 last:border-b-0'
								>
									<div className='text-red-400 font-semibold'>{f.errorMsg}</div>
									<div className='text-neutral-400 break-words'>
										{JSON.stringify(f.rowData)}
									</div>
								</div>
							))}
						</div>
					</div>
				)}
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
							</tr>
						</thead>
						<tbody>
							{participants.length === 0 ? (
								<tr>
									<td
										colSpan={7}
										className='px-3 py-4 text-center text-neutral-500 text-[12px]'
									>
										Aún no hay participantes cargados.
									</td>
								</tr>
							) : (
								participants.map((p, idx) => (
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
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>

				<div className='p-3 text-[10px] text-neutral-500 border-t border-neutral-800'>
					Este listado muestra los datos en Supabase, con chip generado.
				</div>
			</div>

			{/* ROADMAP */}
			<div className='mt-8 text-[11px] text-neutral-500 leading-relaxed border-t border-neutral-800 pt-4'>
				<div className='mb-2 font-medium text-neutral-300 text-[12px]'>
					Próximos pasos:
				</div>
				<ol className='list-decimal list-inside space-y-1'>
					<li>
						Botón “Recalcular categoría”: asignar automáticamente la category_id
						a cada corredor con base en distancia, sexo y edad.
					</li>
					<li>
						Edición rápida inline: corregir dorsal ↔ chip ↔ edad sin reimportar
						desde Excel.
					</li>
				</ol>
			</div>
		</main>
	);
}
