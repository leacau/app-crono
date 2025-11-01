'use client';

import { use, useEffect, useState, useRef } from 'react';
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
	first_name: string;
	last_name: string;
	dni: string | null;
	sex: string;
	birth_date: string | null; // ISO "YYYY-MM-DD" o null
	age: number | null;
	distance_km: number | null;
	category_id: number | null;
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

	// Lista participantes ya cargados
	const [participants, setParticipants] = useState<ParticipantRow[]>([]);
	const [loading, setLoading] = useState(true);

	// ----------------------------------------
	// IMPORTACIÓN MASIVA
	// ----------------------------------------

	// 1. archivo subido y parseado crudo
	const [rawHeaders, setRawHeaders] = useState<string[]>([]);
	const [rawRows, setRawRows] = useState<Record<string, any>[]>([]);
	const [importStep, setImportStep] = useState<'idle' | 'mapped' | 'ready'>(
		'idle'
	); // idle: nada cargado, mapped: tenemos archivo y headers, ready: mapeo definido

	// 2. mapping de columnas -> campos internos
	// Campos internos que soportamos
	// first_name, last_name, dni, sex, birth_date, age, distance_km, bib_number
	const [mapFirstName, setMapFirstName] = useState<string>('');
	const [mapLastName, setMapLastName] = useState<string>('');
	const [mapDni, setMapDni] = useState<string>('');
	const [mapSex, setMapSex] = useState<string>('');
	const [mapBirthDate, setMapBirthDate] = useState<string>('');
	const [mapAge, setMapAge] = useState<string>('');
	const [mapDistance, setMapDistance] = useState<string>('');
	const [mapBib, setMapBib] = useState<string>('');

	// Errores / status de import
	const [importErr, setImportErr] = useState('');
	const [importing, setImporting] = useState(false);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	// ----------------------------------------
	// Utilidades
	// ----------------------------------------

	function parseNumberOrNull(v: any): number | null {
		if (v === undefined || v === null) return null;
		const s = String(v).trim().replace(',', '.');
		if (!s) return null;
		const n = Number(s);
		if (!Number.isFinite(n)) return null;
		return n;
	}

	// Normalizamos sexo:
	// aceptar "M", "F", "X", "Masculino", "Femenino", etc.
	function normalizeSex(v: any): string {
		if (!v && v !== 0) return '';
		const s = String(v).trim().toUpperCase();
		if (s === 'M' || s.startsWith('MAS')) return 'M';
		if (s === 'F' || s.startsWith('FEM')) return 'F';
		if (s === 'X' || s.startsWith('NO') || s.startsWith('NB')) return 'X';
		if (s === 'ALL' || s === 'GENERAL' || s === 'G') return 'ALL';
		return s;
	}

	// Intentar formatear fecha. Queremos YYYY-MM-DD o null.
	// Soportamos "DD/MM/YYYY", "DD-MM-YYYY", "YYYY-MM-DD", o Date de Excel.
	function normalizeDate(v: any): string | null {
		if (!v) return null;
		let s = String(v).trim();
		if (!s) return null;

		if (v instanceof Date && !isNaN(v.getTime())) {
			// YYYY-MM-DD
			return v.toISOString().slice(0, 10);
		}

		// dd/mm/yyyy o dd-mm-yyyy
		const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
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
		const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
		if (m2) {
			const yyyy = m2[1];
			const mm = m2[2].padStart(2, '0');
			const dd = m2[3].padStart(2, '0');
			return `${yyyy}-${mm}-${dd}`;
		}

		return null;
	}

	// Calcula edad si tengo fecha. Si ya me dieron la edad, uso esa.
	function deriveAge(birthISO: string | null, ageRaw: any): number | null {
		const ageNum = parseNumberOrNull(ageRaw);
		if (ageNum !== null) return ageNum;

		if (!birthISO) return null;
		const today = new Date();
		const [Y, M, D] = birthISO.split('-');
		const by = Number(Y);
		const bm = Number(M) - 1;
		const bd = Number(D);

		if (!Number.isFinite(by) || !Number.isFinite(bm) || !Number.isFinite(bd)) {
			return null;
		}

		const bDate = new Date(by, bm, bd);
		if (isNaN(bDate.getTime())) return null;

		let years = today.getFullYear() - bDate.getFullYear();
		const mDiff = today.getMonth() - bDate.getMonth();
		if (mDiff < 0 || (mDiff === 0 && today.getDate() < bDate.getDate())) {
			years -= 1;
		}
		if (years < 0 || years > 120) return null;
		return years;
	}

	// ----------------------------------------
	// Carga inicial (carrera + participantes)
	// ----------------------------------------

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
		} else {
			setParticipants(partData as ParticipantRow[]);
		}

		// reset import state
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

		setLoading(false);
	}

	useEffect(() => {
		loadData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [raceId]);

	// ----------------------------------------
	// 1) Usuario selecciona archivo
	//    Parseamos CSV / XLSX en crudo
	// ----------------------------------------

	async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
		setImportErr('');
		const file = e.target.files?.[0];
		if (!file) return;

		const nameLower = file.name.toLowerCase();
		if (nameLower.endsWith('.csv')) {
			// Parse CSV con Papa
			Papa.parse<Record<string, any>>(file, {
				header: true,
				skipEmptyLines: true,
				complete: (results /*: Papa.ParseResult<Record<string, any>>*/) => {
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
				error: (err /*: Papa.ParseError*/) => {
					console.error('Error Papa:', err);
					setImportErr('No se pudo leer el CSV.');
				},
			});
		} else if (nameLower.endsWith('.xls') || nameLower.endsWith('.xlsx')) {
			// Parse Excel con XLSX
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

	// ----------------------------------------
	// 2) Validar mapeo y preparar import
	// ----------------------------------------

	function validateMappingAndPrepare() {
		setImportErr('');

		// Chequeos mínimos: necesitamos columnas obligatorias
		if (!mapFirstName || !mapLastName || !mapSex || !mapDistance) {
			setImportErr(
				'Faltan columnas obligatorias. Necesitamos al menos Nombre, Apellido, Sexo y Distancia.'
			);
			return;
		}

		// También necesitamos EDAD o FECHA_NACIMIENTO para cada fila al menos una.
		if (!mapBirthDate && !mapAge) {
			setImportErr(
				'Necesitamos Edad o Fecha de nacimiento. Podés mapear una de las dos.'
			);
			return;
		}

		setImportStep('ready');
	}

	// ----------------------------------------
	// 3) Importar a Supabase
	// ----------------------------------------

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

		const batch: any[] = [];

		for (const row of rawRows) {
			const firstNameVal = row[mapFirstName];
			const lastNameVal = row[mapLastName];
			const sexVal = row[mapSex];
			const distVal = row[mapDistance];

			if (
				firstNameVal === undefined ||
				lastNameVal === undefined ||
				sexVal === undefined ||
				distVal === undefined
			) {
				continue;
			}

			const dniVal =
				mapDni && row[mapDni] !== undefined ? String(row[mapDni]).trim() : null;

			const birthRaw =
				mapBirthDate && row[mapBirthDate] !== undefined
					? row[mapBirthDate]
					: null;
			const ageRaw = mapAge && row[mapAge] !== undefined ? row[mapAge] : null;

			const birthISO = normalizeDate(birthRaw);
			const finalAge = deriveAge(birthISO, ageRaw);

			if (!birthISO && finalAge === null) {
				continue;
			}

			const bibRaw = mapBib && row[mapBib] !== undefined ? row[mapBib] : null;
			const bibNum = parseNumberOrNull(bibRaw);

			const distNum = parseNumberOrNull(distVal);
			const normSex = normalizeSex(sexVal);

			if (!firstNameVal || !lastNameVal || !normSex || !distNum) {
				continue;
			}

			batch.push({
				race_id: race.id,
				first_name: String(firstNameVal).trim(),
				last_name: String(lastNameVal).trim(),
				dni: dniVal,
				sex: normSex,
				birth_date: birthISO,
				age: finalAge,
				distance_km: distNum,
				bib_number: bibNum,
				category_id: null,
			});
		}

		if (batch.length === 0) {
			setImportErr(
				'No se generó ninguna fila válida. Revisá el mapeo y los datos (nombre, apellido, sexo, distancia, y al menos edad o fecha).'
			);
			setImporting(false);
			return;
		}

		const { error: insErr } = await supabase.from('participants').insert(batch);

		if (insErr) {
			console.error('Supabase rechazó la importación masiva:', insErr);
			setImportErr('Supabase rechazó la importación masiva.');
			setImporting(false);
			return;
		}

		setImporting(false);

		// recargar tabla de participantes y limpiar estado
		loadData();
	}

	// ----------------------------------------
	// Render
	// ----------------------------------------

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

			{/* IMPORTADOR */}
			<div className='border border-neutral-700 bg-neutral-900 rounded-xl p-4 mb-6 flex flex-col gap-4'>
				<div className='flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3'>
					<div className='flex flex-col gap-1'>
						<div className='text-neutral-300 text-sm font-semibold'>
							Importar desde Excel / CSV
						</div>
						<div className='text-[11px] text-neutral-400 leading-tight'>
							Subí tu planilla de corredores, mapeá las columnas y cargalos a la
							carrera.
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

				{importErr && <div className='text-red-400 text-sm'>{importErr}</div>}

				{/* Paso 1: tenemos archivo parseado, mostrar mapeo */}
				{importStep !== 'idle' && (
					<div className='border border-neutral-700 rounded-lg p-3 bg-neutral-800/30 flex flex-col gap-3'>
						<div className='text-white text-sm font-semibold'>
							Mapeo de columnas
						</div>
						<div className='text-[11px] text-neutral-400 leading-tight'>
							Elegí qué columna del archivo corresponde a cada dato interno.
							Obligatorios: Nombre, Apellido, Sexo, Distancia. Además, Edad o
							Fecha de nacimiento (al menos una).
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
								<span>DNI</span>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2'
									value={mapDni}
									onChange={(e) => setMapDni(e.target.value)}
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
								<span>Fecha de nacimiento (DD/MM/YYYY o YYYY-MM-DD)</span>
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
									Si no tenés fecha, podés usar Edad.
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
								<div className='text-[10px] text-neutral-500 leading-tight'>
									Debe ser número. Si no tenés edad, usá Fecha de nacimiento.
								</div>
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
							</label>

							<label className='flex flex-col gap-1'>
								<span>Dorsal / Pechera</span>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2'
									value={mapBib}
									onChange={(e) => setMapBib(e.target.value)}
								>
									<option value=''>-- Ninguna --</option>
									{rawHeaders.map((h) => (
										<option key={h} value={h}>
											{h}
										</option>
									))}
								</select>
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
			</div>

			{/* LISTADO DE PARTICIPANTES */}
			<div className='border border-neutral-700 bg-neutral-900 rounded-xl overflow-hidden'>
				<div className='overflow-x-auto'>
					<table className='min-w-full text-left text-sm text-neutral-200'>
						<thead className='bg-neutral-800 text-[11px] uppercase text-neutral-400'>
							<tr>
								<th className='px-3 py-2 whitespace-nowrap'>Dorsal</th>
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
										colSpan={6}
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
											{p.sex}
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
					Este listado muestra los datos ya cargados en Supabase.
				</div>
			</div>

			{/* ROADMAP SIGUIENTE */}
			<div className='mt-8 text-[11px] text-neutral-500 leading-relaxed border-t border-neutral-800 pt-4'>
				<div className='mb-2 font-medium text-neutral-300 text-[12px]'>
					Próximos pasos en esta pantalla:
				</div>
				<ol className='list-decimal list-inside space-y-1'>
					<li>
						Botón “Recalcular categoría”: asigna automáticamente la category_id
						de cada corredor según edad, sexo, distancia y las categorías
						ACTIVAS de la carrera.
					</li>
					<li>
						Edición rápida de un participante (cambiar dorsal, corregir
						distancia, etc.).
					</li>
				</ol>
			</div>
		</main>
	);
}
