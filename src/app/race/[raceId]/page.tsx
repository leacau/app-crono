'use client';

import * as XLSX from 'xlsx';

import { use, useEffect, useRef, useState } from 'react';

import { supabase } from '../../../lib/supabaseClient';
import { useRouter } from 'next/navigation';

type Race = {
	id: number;
	name: string;
	date: string;
	location: string | null;
	status: string;
};

type Participant = {
	id: number;
	first_name: string;
	last_name: string;
	bib_number: string | null;
	status: string;
	distance_km: number;
	age_snapshot: number;
	sex: string;
	category_name: string | null;
};

export default function RacePage({
	params,
}: {
	params: Promise<{ raceId: string }>;
}) {
	const router = useRouter();

	// Next 16: params es Promise -> usamos use() para desempaquetar
	const { raceId: raceIdStr } = use(params);
	const raceId = Number(raceIdStr);

	const [race, setRace] = useState<Race | null>(null);
	const [participants, setParticipants] = useState<Participant[]>([]);
	const [loading, setLoading] = useState(true);

	// alta manual (modal individual)
	const [showModal, setShowModal] = useState(false);
	const [saving, setSaving] = useState(false);
	const [errMsg, setErrMsg] = useState('');

	// campos para alta individual
	const [pFirst, setPFirst] = useState('');
	const [pLast, setPLast] = useState('');
	const [pDni, setPDni] = useState('');
	const [pSex, setPSex] = useState('M'); // default M
	const [pBirth, setPBirth] = useState(''); // YYYY-MM-DD
	const [pDist, setPDist] = useState(''); // km
	const [pBib, setPBib] = useState(''); // dorsal (opcional)

	// importación Excel
	const [importing, setImporting] = useState(false);
	const [importErr, setImportErr] = useState('');
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	// =========================================
	// LOAD DATA
	// =========================================

	async function loadData() {
		setLoading(true);

		// 1. carrera
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

		// 2. participantes (con nombre de categoría)
		const { data: partData, error: partErr } = await supabase
			.from('participants')
			.select(
				`
        id,
        first_name,
        last_name,
        bib_number,
        status,
        distance_km,
        age_snapshot,
        sex,
        category:category_id (
          name
        )
      `
			)
			.eq('race_id', raceId)
			.order('last_name', { ascending: true });

		if (partErr) {
			console.error('Error cargando participantes:', partErr);
			setParticipants([]);
		} else {
			const mapped = (partData || []).map((row: any) => ({
				id: row.id,
				first_name: row.first_name,
				last_name: row.last_name,
				bib_number: row.bib_number,
				status: row.status,
				distance_km: row.distance_km,
				age_snapshot: row.age_snapshot,
				sex: row.sex,
				category_name: row.category ? row.category.name : null,
			}));
			setParticipants(mapped);
		}

		setLoading(false);
	}

	useEffect(() => {
		loadData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [raceId]);

	// =========================================
	// HELPERS
	// =========================================

	// Edad en la fecha oficial de la carrera
	function calcularEdadEnFecha(
		nacimientoISO: string,
		fechaCarreraISO: string
	): number {
		// nacimientoISO: "YYYY-MM-DD"
		// fechaCarreraISO: "YYYY-MM-DD"
		const nac = new Date(nacimientoISO + 'T00:00:00');
		const ref = new Date(fechaCarreraISO + 'T00:00:00');
		let edad = ref.getFullYear() - nac.getFullYear();
		const m = ref.getMonth() - nac.getMonth();
		if (m < 0 || (m === 0 && ref.getDate() < nac.getDate())) {
			edad--;
		}
		return edad;
	}

	// Le pasás sex, edad y distancia para esta carrera → devuelve category_id o null
	async function obtenerCategoriaIdCorrecta({
		sex,
		edad,
		distanceKm,
	}: {
		sex: string;
		edad: number;
		distanceKm: number;
	}): Promise<number | null> {
		const { data: cats, error: catErr } = await supabase
			.from('categories')
			.select('id, sex_allowed, age_min, age_max, distance_km, is_active')
			.eq('race_id', raceId)
			.eq('is_active', true);

		if (catErr || !cats) {
			console.error('Error obteniendo categorias:', catErr);
			return null;
		}

		const posibles = cats.filter((c: any) => {
			const sexoOk = c.sex_allowed === 'ANY' || c.sex_allowed === sex;
			const edadOk = edad >= c.age_min && edad <= c.age_max;
			const distOk = Number(distanceKm) === Number(c.distance_km);
			return sexoOk && edadOk && distOk;
		});

		if (posibles.length === 0) {
			return null;
		}

		// si hay más de una coincidencia, elegimos la más específica (menor rango etario)
		posibles.sort((a: any, b: any) => {
			const rangoA = a.age_max - a.age_min;
			const rangoB = b.age_max - b.age_min;
			return rangoA - rangoB;
		});

		return posibles[0].id;
	}

	// intenta parsear fechas que vengan como "YYYY-MM-DD" o "DD/MM/YYYY"
	function normalizarFechaNacimiento(valor: any): string | null {
		if (!valor) return null;

		if (typeof valor === 'string') {
			// caso 1: ya viene ISO "YYYY-MM-DD"
			if (/^\d{4}-\d{2}-\d{2}$/.test(valor.trim())) {
				return valor.trim();
			}

			// caso 2: "DD/MM/YYYY"
			if (/^\d{2}\/\d{2}\/\d{4}$/.test(valor.trim())) {
				const [dd, mm, yyyy] = valor.trim().split('/');
				return `${yyyy}-${mm}-${dd}`; // lo devuelvo como YYYY-MM-DD
			}
		}

		// caso 3: Excel puede darte fechas como número serial (ej: 45512)
		// XLSX lo suele convertir a Date si usamos XLSX.utils.sheet_to_json con {raw: false}
		// pero vamos a intentar fallback: si es número grande, lo interpretamos como serial
		if (typeof valor === 'number') {
			// Excel serial date (desde 1899-12-30)
			const excelEpoch = new Date(Date.UTC(1899, 11, 30));
			const ms = valor * 24 * 60 * 60 * 1000;
			const d = new Date(excelEpoch.getTime() + ms);
			// formateamos a YYYY-MM-DD
			const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
			const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
			const dd = d.getUTCDate().toString().padStart(2, '0');
			return `${yyyy}-${mm}-${dd}`;
		}

		// si no pudimos interpretar, devolvemos null
		return null;
	}

	// =========================================
	// ALTA INDIVIDUAL (modal)
	// =========================================

	async function handleAddParticipant() {
		if (!race) {
			setErrMsg('No hay carrera cargada.');
			return;
		}

		setSaving(true);
		setErrMsg('');

		if (
			!pFirst.trim() ||
			!pLast.trim() ||
			!pDni.trim() ||
			!pBirth.trim() ||
			!pDist.trim()
		) {
			setErrMsg('Completá todos los datos obligatorios.');
			setSaving(false);
			return;
		}

		// 1. Calcular edad en el día de la carrera
		const edad = calcularEdadEnFecha(pBirth, race.date);

		// 2. Buscar la categoría correspondiente
		const catId = await obtenerCategoriaIdCorrecta({
			sex: pSex,
			edad: edad,
			distanceKm: Number(pDist),
		});

		// 3. Insertar en Supabase
		const { error: insertErr } = await supabase.from('participants').insert([
			{
				race_id: race.id,
				first_name: pFirst.trim(),
				last_name: pLast.trim(),
				dni: pDni.trim(),
				sex: pSex,
				birth_date: pBirth,
				age_snapshot: edad,
				distance_km: Number(pDist),
				category_id: catId,
				bib_number: pBib.trim() || null,
				status: 'registered',
			},
		]);

		if (insertErr) {
			console.error('Error insertando participante:', insertErr);
			setErrMsg('No se pudo guardar el corredor.');
			setSaving(false);
			return;
		}

		// limpiar modal
		setPFirst('');
		setPLast('');
		setPDni('');
		setPSex('M');
		setPBirth('');
		setPDist('');
		setPBib('');
		setShowModal(false);
		setSaving(false);

		// recargar lista
		loadData();
	}

	// =========================================
	// IMPORTACIÓN DESDE EXCEL
	// =========================================

	async function procesarExcel(file: File) {
		if (!race) return;

		setImportErr('');
		setImporting(true);

		try {
			// Leemos el archivo binario
			const buffer = await file.arrayBuffer();
			const wb = XLSX.read(buffer, { type: 'array' });

			// Tomamos la primera hoja
			const sheetName = wb.SheetNames[0];
			const sheet = wb.Sheets[sheetName];

			// Convertimos la hoja en array de objetos
			// header: lee la primera fila como encabezados
			const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
			// rows es una matriz tipo [ [header1, header2...], [valRow2Col1, ...], ...]

			if (rows.length < 2) {
				throw new Error(
					'El archivo no tiene datos (necesita encabezados + filas).'
				);
			}

			// construimos un mapa de nombreDeColumna -> índice de columna
			const headers = rows[0].map((h: any) =>
				('' + h).trim().toLowerCase()
			) as string[];

			function idx(colName: string): number {
				// buscamos colName en headers
				// aceptamos alias razonables
				const aliases: Record<string, string[]> = {
					first_name: ['first_name', 'nombre', 'name', 'nombres'],
					last_name: ['last_name', 'apellido', 'apellidos', 'surname'],
					dni: ['dni', 'documento', 'doc'],
					sex: ['sex', 'sexo', 'gender', 'genero', 'género'],
					birth_date: ['birth_date', 'fecha_nacimiento', 'nacimiento', 'dob'],
					distance_km: ['distance_km', 'distancia', 'km', 'distance'],
					bib_number: ['bib_number', 'dorsal', 'pechera', 'numero', 'nro'],
				};

				for (const want of aliases[colName]) {
					const i = headers.findIndex((h) => h === want.toLowerCase());
					if (i !== -1) return i;
				}
				return -1;
			}

			const colFirst = idx('first_name');
			const colLast = idx('last_name');
			const colDni = idx('dni');
			const colSex = idx('sex');
			const colBirth = idx('birth_date');
			const colDist = idx('distance_km');
			const colBib = idx('bib_number'); // opcional

			// Validamos que al menos lo esencial exista
			if (
				colFirst === -1 ||
				colLast === -1 ||
				colDni === -1 ||
				colSex === -1 ||
				colBirth === -1 ||
				colDist === -1
			) {
				throw new Error(
					'Faltan columnas obligatorias. Necesitamos: nombre, apellido, dni, sexo, fecha_nacimiento, distancia_km.'
				);
			}

			// Ahora recorremos cada fila de datos (arranca en 1 porque 0 son headers)
			const inserts: any[] = [];

			for (let r = 1; r < rows.length; r++) {
				const row = rows[r];

				// si la fila está vacía, la salteamos
				if (
					!row ||
					row.every(
						(cell: any) => cell === undefined || cell === null || cell === ''
					)
				) {
					continue;
				}

				const rawFirst = row[colFirst];
				const rawLast = row[colLast];
				const rawDni = row[colDni];
				const rawSex = row[colSex];
				const rawBirth = row[colBirth];
				const rawDist = row[colDist];
				const rawBib = colBib !== -1 ? row[colBib] : null;

				if (
					!rawFirst ||
					!rawLast ||
					!rawDni ||
					!rawSex ||
					!rawBirth ||
					!rawDist
				) {
					// faltan datos clave -> lo salteamos silencioso
					console.warn('Fila incompleta, se omite:', row);
					continue;
				}

				// normalizamos fecha de nacimiento
				const birthISO = normalizarFechaNacimiento(rawBirth);
				if (!birthISO) {
					console.warn('No pude interpretar fecha nacimiento en fila:', row);
					continue;
				}

				// sexo en mayúscula tipo 'M'/'F'/'X'
				const sexNorm = ('' + rawSex).trim().toUpperCase();
				// distancia a número
				const distNum = Number(rawDist);

				if (!Number.isFinite(distNum) || distNum <= 0) {
					console.warn('Distancia inválida en fila:', row);
					continue;
				}

				// edad snapshot según fecha de la carrera
				const edadSnap = calcularEdadEnFecha(birthISO, race.date);

				// buscamos categoría que encaje
				const catId = await obtenerCategoriaIdCorrecta({
					sex: sexNorm,
					edad: edadSnap,
					distanceKm: distNum,
				});

				inserts.push({
					race_id: race.id,
					first_name: ('' + rawFirst).trim(),
					last_name: ('' + rawLast).trim(),
					dni: ('' + rawDni).trim(),
					sex: sexNorm,
					birth_date: birthISO,
					age_snapshot: edadSnap,
					distance_km: distNum,
					category_id: catId,
					bib_number: rawBib ? ('' + rawBib).trim() : null,
					status: 'registered',
				});
			}

			if (inserts.length === 0) {
				throw new Error('No se pudo importar ninguna fila válida.');
			}

			// hacemos insert masivo en Supabase
			const { error: batchErr } = await supabase
				.from('participants')
				.insert(inserts);

			if (batchErr) {
				console.error('Error insertando batch:', batchErr);
				throw new Error('Supabase rechazó la importación masiva.');
			}

			// listo: refrescamos
			await loadData();
		} catch (err: any) {
			console.error('Error en importación:', err);
			setImportErr(err.message || 'Error al importar archivo.');
		} finally {
			setImporting(false);
		}
	}

	function handleClickImportar() {
		// abre el selector de archivo
		if (fileInputRef.current) {
			fileInputRef.current.value = ''; // reseteamos para poder reimportar el mismo archivo
			fileInputRef.current.click();
		}
	}

	async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;
		await procesarExcel(file);
	}

	// =========================================
	// RENDER
	// =========================================

	if (loading && !race) {
		return (
			<main className='min-h-screen bg-neutral-950 text-white p-4'>
				<div className='text-neutral-400'>Cargando carrera...</div>
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
			{/* HEADER CARRERA */}
			<div className='flex flex-col gap-1 mb-4'>
				<div className='text-sm text-neutral-400 flex items-center gap-2'>
					<button
						className='underline text-neutral-300'
						onClick={() => router.push('/')}
					>
						← Volver
					</button>
					<span className='text-neutral-600'>/</span>
					<span>{race.id}</span>
				</div>

				<h1 className='text-2xl font-bold'>{race.name}</h1>

				<div className='text-sm text-neutral-400'>
					{race.date} · {race.location || 'Sin ubicación'}
				</div>

				<div className='text-xs mt-1 inline-block px-2 py-1 rounded bg-neutral-800 text-neutral-300 border border-neutral-600 w-fit'>
					{race.status}
				</div>
			</div>

			{/* ACCIONES DE CARRERA */}
			<section className='mb-6 flex flex-col gap-3'>
				<div className='flex flex-wrap gap-3'>
					{/* Alta individual */}
					<button
						className='flex-1 bg-emerald-600 text-white text-sm font-semibold px-3 py-3 rounded-lg active:scale-95 text-center'
						onClick={() => {
							setShowModal(true);
							setErrMsg('');
						}}
					>
						+ Participante
					</button>

					{/* Cronómetro */}
					<button
						className='flex-1 bg-blue-600 text-white text-sm font-semibold px-3 py-3 rounded-lg active:scale-95 text-center'
						onClick={() => {
							router.push(`/race/${raceId}/timer`);
						}}
					>
						Cronómetro
					</button>

					{/* Resultados */}
					<button
						className='flex-1 bg-purple-600 text-white text-sm font-semibold px-3 py-3 rounded-lg active:scale-95 text-center'
						onClick={() => {
							router.push(`/race/${raceId}/results`);
						}}
					>
						Resultados
					</button>
				</div>

				{/* Importar Excel */}
				<div className='flex flex-col gap-2 bg-neutral-900 border border-neutral-700 rounded-xl p-3'>
					<div className='flex items-center justify-between'>
						<div className='text-sm font-semibold text-white flex flex-col'>
							<span>Importar planilla Excel</span>
							<span className='text-[11px] text-neutral-400 font-normal'>
								Columnas mínimas: nombre, apellido, dni, sexo, fecha_nacimiento,
								distancia_km, (dorsal opcional)
							</span>
						</div>

						<button
							className='bg-neutral-800 text-white text-xs font-semibold px-3 py-2 rounded-lg border border-neutral-600 active:scale-95 disabled:opacity-50 disabled:active:scale-100'
							disabled={importing}
							onClick={handleClickImportar}
						>
							{importing ? 'Importando...' : 'Subir .xlsx'}
						</button>

						{/* input oculto real */}
						<input
							ref={fileInputRef}
							type='file'
							className='hidden'
							accept='.xlsx,.xls'
							onChange={handleFileSelected}
						/>
					</div>

					{importErr && <div className='text-red-400 text-xs'>{importErr}</div>}
				</div>

				{/* Resumen participantes */}
				<div className='text-lg font-semibold mt-2'>
					Participantes ({participants.length})
				</div>

				{participants.length === 0 ? (
					<div className='text-neutral-400 text-sm'>
						No hay participantes todavía.
					</div>
				) : (
					<ul className='flex flex-col gap-2'>
						{participants.map((p) => (
							<li
								key={p.id}
								className='rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-sm flex flex-col'
							>
								<div className='flex justify-between'>
									<div className='font-semibold'>
										{p.last_name.toUpperCase()}, {p.first_name}
									</div>
									<div className='text-neutral-400'>
										#{p.bib_number || 's/d'}
									</div>
								</div>

								<div className='text-neutral-400 flex flex-wrap gap-2 text-xs mt-1'>
									<span>{p.sex}</span>
									<span>{p.age_snapshot} años</span>
									<span>{p.distance_km}K</span>
									<span>{p.category_name || 'Sin categoría'}</span>
									<span>{p.status}</span>
								</div>
							</li>
						))}
					</ul>
				)}
			</section>

			{/* MODAL NUEVO PARTICIPANTE (ALTA INDIVIDUAL) */}
			{showModal && (
				<div className='fixed inset-0 flex items-center justify-center bg-black/70 p-4 z-50'>
					<div className='w-full max-w-sm bg-neutral-900 border border-neutral-700 rounded-xl p-4 flex flex-col gap-4'>
						<div className='flex items-start justify-between'>
							<div className='text-lg font-semibold'>Nuevo participante</div>
							<button
								className='text-neutral-400 text-sm'
								disabled={saving}
								onClick={() => {
									setShowModal(false);
									setErrMsg('');
								}}
							>
								✕
							</button>
						</div>

						<div className='text-xs text-neutral-400'>
							Carrera #{race.id} · {race.name}
						</div>

						{errMsg && <div className='text-red-400 text-sm'>{errMsg}</div>}

						<label className='text-sm flex flex-col gap-1'>
							<span>Nombre</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={pFirst}
								onChange={(e) => setPFirst(e.target.value)}
								disabled={saving}
								placeholder='Juan'
							/>
						</label>

						<label className='text-sm flex flex-col gap-1'>
							<span>Apellido</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={pLast}
								onChange={(e) => setPLast(e.target.value)}
								disabled={saving}
								placeholder='Pérez'
							/>
						</label>

						<label className='text-sm flex flex-col gap-1'>
							<span>DNI</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={pDni}
								onChange={(e) => setPDni(e.target.value)}
								disabled={saving}
								placeholder='12345678'
							/>
						</label>

						<label className='text-sm flex flex-col gap-1'>
							<span>Sexo</span>
							<select
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={PSex}
								onChange={(e) => setPSex(e.target.value)}
								disabled={saving}
							>
								<option value='M'>M</option>
								<option value='F'>F</option>
								<option value='X'>X</option>
							</select>
						</label>

						<label className='text-sm flex flex-col gap-1'>
							<span>Fecha de nacimiento</span>
							<input
								type='date'
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={pBirth}
								onChange={(e) => setPBirth(e.target.value)}
								disabled={saving}
							/>
						</label>

						<label className='text-sm flex flex-col gap-1'>
							<span>Distancia (km)</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={pDist}
								onChange={(e) => setPDist(e.target.value)}
								disabled={saving}
								placeholder='10'
							/>
						</label>

						<label className='text-sm flex flex-col gap-1'>
							<span>Dorsal (opcional)</span>
							<input
								className='w-full rounded-lg bg-neutral-800 border border-neutral-600 px-3 py-2 text-white text-base'
								value={pBib}
								onChange={(e) => setPBib(e.target.value)}
								disabled={saving}
								placeholder='154'
							/>
						</label>

						<button
							className='w-full bg-emerald-600 text-white font-semibold text-base px-4 py-3 rounded-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100'
							disabled={saving}
							onClick={handleAddParticipant}
						>
							{saving ? 'Guardando...' : 'Guardar participante'}
						</button>
					</div>
				</div>
			)}
		</main>
	);
}
