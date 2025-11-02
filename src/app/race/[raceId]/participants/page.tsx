'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import { supabase } from '../../../../lib/supabaseClient';

// ------------------------------
// Tipos de datos
// ------------------------------
type Race = {
	id: number;
	name: string;
	date: string | null;
	location: string | null;
	status: string | null;
};

type CategoryRow = {
	id: number;
	race_id: number;
	name: string;
	distance_km: number | null;
	sex_filter: string;
	age_min: number | null;
	age_max: number | null;
	is_active: boolean;
};

type ParticipantRow = {
	id: number;
	race_id: number;
	bib_number: number | null;
	chip: string | null;
	first_name: string;
	last_name: string;
	dni: string;
	sex: string;
	birth_date: string | null; // ISO
	age: number | null;
	distance_km: number | null;
	category_id: number | null;
	category: { name: string } | null; // relación 1:1
	status: string | null;
};

// para la importación
type ImportPreviewRow = {
	first_name: string;
	last_name: string;
	dni: string;
	sex: string;
	distance_km: number;
	bib_number: number | null;
	birth_date: string | null;
	age: number | null;
};

// ------------------------------
// Página
// ------------------------------
export default function ParticipantsPage({
	params,
}: {
	params: Promise<{ raceId: string }>;
}) {
	const { raceId: raceIdStr } = use(params);
	const raceId = Number(raceIdStr);

	const router = useRouter();

	// Ajustá esta función si tu ruta pública de detalle es distinta
	// Ejemplos alternativos:
	// return `/public/race/${raceId}/participants/${pid}`;
	// return `/participants/${pid}`;
	function getParticipantDetailPath(pid: number) {
		return `/race/${raceId}/participants/${pid}`;
	}

	// carrera
	const [race, setRace] = useState<Race | null>(null);

	// categorías activas (para asignación automática)
	const [categories, setCategories] = useState<CategoryRow[]>([]);

	// participantes ya existentes en la BD
	const [participants, setParticipants] = useState<ParticipantRow[]>([]);

	// estados de carga
	const [loading, setLoading] = useState(true);
	const [loadErr, setLoadErr] = useState('');

	// importación CSV/XLSX->CSV
	const [fileObj, setFileObj] = useState<File | null>(null);
	const [csvErr, setCsvErr] = useState('');
	const [previewRows, setPreviewRows] = useState<ImportPreviewRow[]>([]);
	const [excludedRows, setExcludedRows] = useState<
		{ rowIndex: number; reason: string; raw: any }[]
	>([]);
	const [importing, setImporting] = useState(false);

	// mapeo de columnas
	const [colMap, setColMap] = useState<{
		first_name: string;
		last_name: string;
		dni: string;
		sex: string;
		distance_km: string;
		bib_number: string;
		birth_date: string;
		age: string;
	}>({
		first_name: 'nombre',
		last_name: 'apellido',
		dni: 'dni',
		sex: 'sexo',
		distance_km: 'distancia_km',
		bib_number: 'dorsal',
		birth_date: 'fecha_nacimiento',
		age: 'edad',
	});

	// búsqueda
	const [searchTerm, setSearchTerm] = useState('');

	// edición puntual / alta puntual
	const [editModalOpen, setEditModalOpen] = useState(false);
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
	const [formStatus, setFormStatus] = useState('registered');
	const [formErr, setFormErr] = useState('');
	const [savingParticipant, setSavingParticipant] = useState(false);

	// ------------------------------
	// Cargar datos iniciales
	// ------------------------------
	async function loadData() {
		setLoading(true);
		setLoadErr('');

		// 1. carrera
		const { data: rdata, error: rerr } = await supabase
			.from('races')
			.select('id,name,date,location,status')
			.eq('id', raceId)
			.single();

		if (rerr) {
			console.error(rerr);
			setRace(null);
			setLoadErr(rerr.message || 'No se pudo cargar la carrera seleccionada.');
			setLoading(false);
			return;
		} else {
			setRace(rdata as Race);
		}

		// 2. categorías activas
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
			.eq('is_active', true);

		if (cerr) {
			console.error('Error cargando categorías:', cerr);
			setCategories([]);
		} else {
			setCategories((cdata || []) as CategoryRow[]);
		}

		// 3. participantes (IMPORTANTE: select sin campos fantasma)
		const { data: pdata, error: perr } = await supabase
			.from('participants')
			.select(
				`
          id,
          race_id,
          bib_number,
          chip,
          first_name,
          last_name,
          dni,
          sex,
          birth_date,
          age,
          distance_km,
          category_id,
          category:categories ( name ),
          status
        `
			)
			.eq('race_id', raceId)
			.order('last_name', { ascending: true })
			.order('first_name', { ascending: true });

		if (perr) {
			console.error(perr);
			setParticipants([]);
			setLoadErr(perr.message || 'No se pudieron cargar los participantes.');
			setLoading(false);
			return;
		} else {
			// normaliza category
			const normalized = (pdata || []).map((p: any) => ({
				...p,
				category:
					p.category && Array.isArray(p.category)
						? p.category[0] ?? null
						: p.category ?? null,
			}));
			setParticipants(normalized as ParticipantRow[]);
		}

		setLoading(false);
		setCsvErr('');
		setPreviewRows([]);
		setExcludedRows([]);
		setFileObj(null);
	}

	useEffect(() => {
		loadData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [raceId]);

	// ------------------------------
	// Métricas rápidas / KPIs
	// ------------------------------
	const totalCount = participants.length;

	const totalWithCategory = useMemo(
		() =>
			participants.filter(
				(p) =>
					p.category_id !== null &&
					p.category_id !== undefined &&
					p.category_id !== 0
			).length,
		[participants]
	);

	const totalWithoutCategory = totalCount - totalWithCategory;

	const countByDistance = useMemo(() => {
		const map: Record<string, number> = {};
		for (const p of participants) {
			const key = p.distance_km != null ? String(p.distance_km) : '—';
			map[key] = (map[key] || 0) + 1;
		}
		return map;
	}, [participants]);

	const countBySex = useMemo(() => {
		const map: Record<string, number> = {};
		for (const p of participants) {
			const key = p.sex || '—';
			map[key] = (map[key] || 0) + 1;
		}
		return map;
	}, [participants]);

	// ------------------------------
	// Agrupar por categoría (para vista podio)
	// ------------------------------
	const participantsByCategory = useMemo(() => {
		const groups: Record<string, ParticipantRow[]> = {};

		for (const p of participants) {
			let catName = 'Sin categoría';
			if (p.category && typeof p.category.name === 'string') {
				const n = p.category.name.trim();
				if (n !== '') catName = n;
			}

			if (!groups[catName]) {
				groups[catName] = [];
			}
			groups[catName].push(p);
		}

		// ordenar cada grupo por dorsal asc
		for (const k of Object.keys(groups)) {
			groups[k].sort((a, b) => {
				const A = a.bib_number ?? 999999;
				const B = b.bib_number ?? 999999;
				return A - B;
			});
		}

		return groups;
	}, [participants]);

	// Lista “sin categoría” limpia
	const unassignedParticipants = useMemo(
		() =>
			participants.filter(
				(p) =>
					!p.category_id ||
					!p.category ||
					!p.category.name ||
					p.category.name.trim() === ''
			),
		[participants]
	);

	// ------------------------------
	// Filtro de búsqueda rápida
	// ------------------------------
	const filteredParticipants = useMemo(() => {
		if (!searchTerm.trim()) return participants;

		const term = searchTerm.trim().toLowerCase();
		return participants.filter((p) => {
			const fullName = `${p.last_name} ${p.first_name}`.toLowerCase();
			return (
				fullName.includes(term) ||
				(p.dni || '').toLowerCase().includes(term) ||
				(p.bib_number != null &&
					String(p.bib_number).toLowerCase().includes(term))
			);
		});
	}, [participants, searchTerm]);

	// ------------------------------
	// Helpers normalización CSV
	// ------------------------------
	function cleanName(raw: any): string {
		if (!raw) return '';
		return String(raw).trim().replace(/\s+/g, ' ');
	}

	function cleanNumber(raw: any): string {
		if (!raw && raw !== 0) return '';
		return String(raw).replace(/\D+/g, '');
	}

	function cleanDistance(raw: any): number | null {
		if (raw == null) return null;
		const txt = String(raw)
			.trim()
			.replace(',', '.')
			.replace(/[^0-9.]/g, '');
		if (txt === '') return null;
		const num = Number(txt);
		if (!Number.isFinite(num)) return null;
		return num;
	}

	function parseAgeOrBirthDate(ageTxt: any, birthTxt: any) {
		let ageVal: number | null = null;
		let birthVal: string | null = null;

		if (birthTxt) {
			let b = String(birthTxt).trim();
			if (b.includes('/')) {
				const m = b.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
				if (m) {
					let day = m[1].padStart(2, '0');
					let mon = m[2].padStart(2, '0');
					let yr = m[3];
					if (yr.length === 2) {
						yr = '19' + yr;
					}
					birthVal = `${yr}-${mon}-${day}`;
				} else {
					birthVal = b;
				}
			} else {
				birthVal = b;
			}
		}

		if (ageTxt !== undefined && ageTxt !== null && ageTxt !== '') {
			const n = Number(String(ageTxt).replace(/\D+/g, ''));
			if (Number.isFinite(n) && n > 0 && n < 120) {
				ageVal = n;
			}
		}

		return { ageVal, birthVal };
	}

	function buildChipFromBib(bib: number | null) {
		if (!bib && bib !== 0) return null;
		const bibStr = String(bib);
		const padded = bibStr.padStart(5, '0');
		return 'LT' + padded;
	}

	// ------------------------------
	// Parsear archivo con PapaParse (solo carga inicial)
	// ------------------------------
	function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
		setCsvErr('');
		setPreviewRows([]);
		setExcludedRows([]);
		if (!e.target.files || e.target.files.length === 0) {
			setFileObj(null);
			return;
		}
		const f = e.target.files[0];
		setFileObj(f);

		Papa.parse(f, {
			header: true,
			skipEmptyLines: true,
			complete: (results: any) => {
				const rows: any[] = results.data || [];
				if (!rows.length) {
					setCsvErr('El archivo está vacío o no pude leer filas.');
					return;
				}
				setPreviewRows([]);
				setExcludedRows([]);
			},
			error: (err: any) => {
				console.error('Papa parse error:', err);
				setCsvErr('Error leyendo el archivo. Revisá el formato.');
			},
		});
	}

	// Procesar archivo según el mapping
	function handleProcessFile() {
		if (!fileObj) {
			setCsvErr('Primero seleccioná un archivo.');
			return;
		}

		setCsvErr('');
		setPreviewRows([]);
		setExcludedRows([]);

		Papa.parse(fileObj, {
			header: true,
			skipEmptyLines: true,
			complete: (results: any) => {
				const rawRows: any[] = results.data || [];

				const goodRows: ImportPreviewRow[] = [];
				const badRows: { rowIndex: number; reason: string; raw: any }[] = [];

				rawRows.forEach((r, idx) => {
					const lastName = cleanName(r[colMap.last_name]);
					const firstName = cleanName(r[colMap.first_name]);
					const dni = cleanNumber(r[colMap.dni]);
					const sex = (r[colMap.sex] || '').toString().trim().toUpperCase();
					const distVal = cleanDistance(r[colMap.distance_km]);
					const bibClean = cleanNumber(r[colMap.bib_number]);
					const ageRaw = r[colMap.age];
					const birthRaw = r[colMap.birth_date];

					const { ageVal, birthVal } = parseAgeOrBirthDate(ageRaw, birthRaw);

					if (!lastName || !firstName) {
						badRows.push({
							rowIndex: idx + 1,
							reason: 'Falta nombre o apellido',
							raw: r,
						});
						return;
					}
					if (!dni) {
						badRows.push({
							rowIndex: idx + 1,
							reason: 'Falta DNI',
							raw: r,
						});
						return;
					}
					if (!sex) {
						badRows.push({
							rowIndex: idx + 1,
							reason: 'Falta sexo',
							raw: r,
						});
						return;
					}
					if (distVal == null) {
						badRows.push({
							rowIndex: idx + 1,
							reason: 'Falta distancia',
							raw: r,
						});
						return;
					}
					if (ageVal == null && !birthVal) {
						badRows.push({
							rowIndex: idx + 1,
							reason: 'Falta edad o fecha nacimiento (al menos una)',
							raw: r,
						});
						return;
					}

					let bibNum: number | null = null;
					if (bibClean !== '') {
						const n = Number(bibClean);
						if (Number.isFinite(n)) {
							bibNum = n;
						}
					}

					goodRows.push({
						first_name: firstName,
						last_name: lastName,
						dni: dni,
						sex: sex,
						distance_km: distVal ?? 0,
						bib_number: bibNum,
						birth_date: birthVal || null,
						age: ageVal ?? null,
					});
				});

				setPreviewRows(goodRows);
				setExcludedRows(badRows);
			},
			error: (err: any) => {
				console.error('Papa parse error:', err);
				setCsvErr('Error procesando el archivo.');
			},
		});
	}

	// ------------------------------
	// Importar previewRows a Supabase
	// ------------------------------
	async function handleImportToSupabase() {
		if (!race) return;
		if (previewRows.length === 0) {
			alert('No hay filas válidas para importar.');
			return;
		}

		setImporting(true);

		// Traer DNIs existentes
		const { data: existing, error: exErr } = await supabase
			.from('participants')
			.select('dni')
			.eq('race_id', race.id);

		if (exErr) {
			console.error(exErr);
			alert('No pude validar DNIs existentes.');
			setImporting(false);
			return;
		}

		const dniSet = new Set((existing || []).map((row: any) => row.dni));

		const rowsToInsert: any[] = [];
		const newExcluded = [...excludedRows];

		for (const row of previewRows) {
			if (dniSet.has(row.dni)) {
				newExcluded.push({
					rowIndex: -1,
					reason: `DNI duplicado ${row.dni}`,
					raw: row,
				});
				continue;
			}

			const age_snapshot = row.age != null ? row.age : null;
			const final_age_snapshot = age_snapshot ?? 99;

			const chip = buildChipFromBib(row.bib_number);

			rowsToInsert.push({
				race_id: race.id,
				first_name: row.first_name,
				last_name: row.last_name,
				dni: row.dni,
				sex: row.sex,
				distance_km: row.distance_km,
				bib_number: row.bib_number,
				chip: chip,
				birth_date: row.birth_date,
				age: row.age,
				status: 'registered',
				age_snapshot: final_age_snapshot,
			});
		}

		setExcludedRows(newExcluded);

		if (rowsToInsert.length === 0) {
			alert('No se generó ninguna fila válida. Todos duplicados o inválidos.');
			setImporting(false);
			return;
		}

		const { error: insErr } = await supabase
			.from('participants')
			.insert(rowsToInsert);

		if (insErr) {
			console.error('Supabase rechazó la importación masiva: ', insErr);
			alert('Supabase rechazó la importación masiva.\nDetalles en consola.');
			setImporting(false);
			return;
		}

		await loadData();
		setImporting(false);
		alert('Importación realizada.');
	}

	// ------------------------------
	// Alta/edición manual
	// ------------------------------
	function openNewParticipant() {
		resetParticipantForm();
		setEditMode('new');
		setEditModalOpen(true);
	}

	function openEditParticipant(p: ParticipantRow) {
		resetParticipantForm();
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
		setFormStatus(p.status || 'registered');

		setEditModalOpen(true);
	}

	function resetParticipantForm() {
		setEditId(null);
		setFormFirstName('');
		setFormLastName('');
		setFormDni('');
		setFormSex('M');
		setFormBirthDate('');
		setFormAge('');
		setFormDistance('');
		setFormBib('');
		setFormStatus('registered');
		setFormErr('');
		setSavingParticipant(false);
	}

	async function handleSaveParticipant() {
		if (!race) return;

		setSavingParticipant(true);
		setFormErr('');

		const ln = cleanName(formLastName);
		const fn = cleanName(formFirstName);
		const dniC = cleanNumber(formDni);
		const sx = formSex.trim().toUpperCase();
		const distParsed = cleanDistance(formDistance);
		let bibNum: number | null = null;
		if (formBib !== '') {
			const n = Number(cleanNumber(formBib));
			if (Number.isFinite(n)) bibNum = n;
		}

		const { ageVal, birthVal } = parseAgeOrBirthDate(formAge, formBirthDate);

		if (!ln || !fn) {
			setFormErr('Nombre y Apellido son obligatorios.');
			setSavingParticipant(false);
			return;
		}
		if (!dniC) {
			setFormErr('DNI es obligatorio.');
			setSavingParticipant(false);
			return;
		}
		if (!sx) {
			setFormErr('Sexo es obligatorio.');
			setSavingParticipant(false);
			return;
		}
		if (distParsed == null) {
			setFormErr('Distancia es obligatoria.');
			setSavingParticipant(false);
			return;
		}
		if (ageVal == null && !birthVal) {
			setFormErr('Edad o Fecha de nacimiento (una).');
			setSavingParticipant(false);
			return;
		}

		const chip = buildChipFromBib(bibNum);
		const final_age_snapshot = ageVal != null ? ageVal : 99;

		const row: any = {
			race_id: race.id,
			last_name: ln,
			first_name: fn,
			dni: dniC,
			sex: sx,
			distance_km: distParsed,
			bib_number: bibNum,
			chip,
			birth_date: birthVal,
			age: ageVal ?? null,
			age_snapshot: final_age_snapshot,
			status: formStatus || 'registered',
		};

		if (editMode === 'new') {
			const { data: existingDni, error: exErr } = await supabase
				.from('participants')
				.select('id')
				.eq('race_id', race.id)
				.eq('dni', dniC)
				.limit(1);

			if (exErr) {
				console.error(exErr);
				setFormErr('Error validando duplicados de DNI.');
				setSavingParticipant(false);
				return;
			}
			if (existingDni && existingDni.length > 0) {
				setFormErr('Ya existe un participante con ese DNI en esta carrera.');
				setSavingParticipant(false);
				return;
			}

			const { error: insErr } = await supabase
				.from('participants')
				.insert([row]);
			if (insErr) {
				console.error(insErr);
				setFormErr('No pude crear el participante. Revisá los datos.');
				setSavingParticipant(false);
				return;
			}
		} else {
			const { error: upErr } = await supabase
				.from('participants')
				.update(row)
				.eq('id', editId)
				.eq('race_id', race.id);

			if (upErr) {
				console.error(upErr);
				setFormErr('No pude actualizar el participante. Revisá los datos.');
				setSavingParticipant(false);
				return;
			}
		}

		await loadData();
		setEditModalOpen(false);
		setSavingParticipant(false);
	}

	// ------------------------------
	// Borrar participante
	// ------------------------------
	async function handleDeleteParticipant(p: ParticipantRow) {
		if (!race) return;
		const ok = window.confirm(
			`Vas a borrar a ${p.last_name}, ${p.first_name} (DNI ${p.dni}). ¿Confirmás?`
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

	// ------------------------------
	// Recalcular categorías (auto-asignar category_id)
	// ------------------------------
	async function handleAssignCategories() {
		if (!race) return;

		const { data: catsFresh, error: catErr } = await supabase
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
			.eq('race_id', race.id)
			.eq('is_active', true);

		if (catErr) {
			console.error(catErr);
			alert('No pude cargar categorías activas.');
			return;
		}

		const activeCats = (catsFresh || []) as CategoryRow[];

		for (const p of participants) {
			if (p.distance_km == null || !p.sex || (p.age == null && !p.birth_date)) {
				continue;
			}

			const effAge = p.age;
			if (effAge == null) continue;

			const matches = activeCats.filter((c) => {
				if (
					c.distance_km == null ||
					Number(c.distance_km) !== Number(p.distance_km)
				)
					return false;

				if (c.sex_filter !== 'ALL' && c.sex_filter !== p.sex) return false;

				if (c.age_min != null && effAge < c.age_min) return false;
				if (c.age_max != null && effAge > c.age_max) return false;

				return true;
			});

			if (matches.length === 0) continue;

			let chosen = matches[0];
			let bestSpan = spanOf(matches[0]);
			for (let i = 1; i < matches.length; i++) {
				const span = spanOf(matches[i]);
				if (span < bestSpan) {
					chosen = matches[i];
					bestSpan = span;
				}
			}

			if (p.category_id !== chosen.id) {
				await supabase
					.from('participants')
					.update({ category_id: chosen.id })
					.eq('id', p.id)
					.eq('race_id', race.id);
			}
		}

		await loadData();

		function spanOf(c: CategoryRow) {
			const min = c.age_min ?? 0;
			const max = c.age_max ?? 200;
			return max - min;
		}
	}

	// ------------------------------
	// UI principal
	// ------------------------------

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
		<main className='min-h-screen bg-neutral-950 text-white p-4 pb-28'>
			{/* HEADER / MIGAS */}
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
						Participantes
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

			{/* KPIs RÁPIDOS */}
			<div className='grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6'>
				<div className='bg-neutral-900 border border-neutral-700 rounded-xl p-3'>
					<div className='text-[11px] text-neutral-500 uppercase tracking-wide'>
						Total
					</div>
					<div className='text-2xl font-semibold text-white'>{totalCount}</div>
				</div>

				<div className='bg-neutral-900 border border-neutral-700 rounded-xl p-3'>
					<div className='text-[11px] text-neutral-500 uppercase tracking-wide'>
						Con categoría
					</div>
					<div className='text-2xl font-semibold text-emerald-400'>
						{totalWithCategory}
					</div>
				</div>

				<div className='bg-neutral-900 border border-neutral-700 rounded-xl p-3'>
					<div className='text-[11px] text-neutral-500 uppercase tracking-wide'>
						Sin categoría
					</div>
					<div className='text-2xl font-semibold text-red-400'>
						{totalWithoutCategory}
					</div>
				</div>

				<div className='bg-neutral-900 border border-neutral-700 rounded-xl p-3'>
					<div className='text-[11px] text-neutral-500 uppercase tracking-wide'>
						Por sexo
					</div>
					<div className='text-[12px] text-neutral-200 leading-tight flex flex-col gap-1 mt-1'>
						{Object.keys(countBySex).map((sx) => (
							<div key={sx} className='flex justify-between'>
								<span className='text-neutral-400'>{sx}</span>
								<span className='text-white font-semibold'>
									{countBySex[sx]}
								</span>
							</div>
						))}
					</div>
				</div>

				<div className='bg-neutral-900 border border-neutral-700 rounded-xl p-3 col-span-2 sm:col-span-1'>
					<div className='text-[11px] text-neutral-500 uppercase tracking-wide'>
						Por distancia (km)
					</div>
					<div className='text-[12px] text-neutral-200 leading-tight flex flex-col gap-1 mt-1 max-h-24 overflow-y-auto pr-1'>
						{Object.keys(countByDistance).map((dist) => (
							<div key={dist} className='flex justify-between'>
								<span className='text-neutral-400'>{dist}K</span>
								<span className='text-white font-semibold'>
									{countByDistance[dist]}
								</span>
							</div>
						))}
					</div>
				</div>
			</div>

			{/* ACCIONES ADMIN */}
			<div className='grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10'>
				{/* BLOQUE IMPORTACIÓN */}
				<div className='bg-neutral-900 border border-neutral-700 rounded-xl p-4 space-y-4'>
					<div className='flex justify-between items-start'>
						<div>
							<div className='text-lg font-semibold text-white'>
								Importar planilla
							</div>
							<div className='text-[11px] text-neutral-500 leading-tight'>
								Sube un CSV (Excel → CSV). Mapeá las columnas. Procesá. Luego
								importá en la base.
							</div>
						</div>
					</div>

					{csvErr && (
						<div className='text-red-400 text-sm bg-red-950/30 border border-red-700 rounded-lg px-3 py-2'>
							{csvErr}
						</div>
					)}

					<div className='flex flex-col gap-3 text-[13px]'>
						<input
							type='file'
							accept='.csv,text/csv'
							className='text-[12px] text-neutral-300'
							onChange={handleFileChange}
						/>

						{/* Mapeo de columnas */}
						<div className='grid grid-cols-2 gap-2'>
							<ColumnMapper
								label='Apellido'
								value={colMap.last_name}
								onChange={(v) => setColMap({ ...colMap, last_name: v })}
							/>
							<ColumnMapper
								label='Nombre'
								value={colMap.first_name}
								onChange={(v) => setColMap({ ...colMap, first_name: v })}
							/>
							<ColumnMapper
								label='DNI'
								value={colMap.dni}
								onChange={(v) => setColMap({ ...colMap, dni: v })}
							/>
							<ColumnMapper
								label='Sexo'
								value={colMap.sex}
								onChange={(v) => setColMap({ ...colMap, sex: v })}
							/>
							<ColumnMapper
								label='Distancia (km)'
								value={colMap.distance_km}
								onChange={(v) => setColMap({ ...colMap, distance_km: v })}
							/>
							<ColumnMapper
								label='Dorsal'
								value={colMap.bib_number}
								onChange={(v) => setColMap({ ...colMap, bib_number: v })}
							/>
							<ColumnMapper
								label='Fecha nacimiento'
								value={colMap.birth_date}
								onChange={(v) => setColMap({ ...colMap, birth_date: v })}
							/>
							<ColumnMapper
								label='Edad'
								value={colMap.age}
								onChange={(v) => setColMap({ ...colMap, age: v })}
							/>
						</div>

						<button
							className='bg-neutral-800 border border-neutral-600 rounded-lg px-3 py-2 text-[13px] text-white active:scale-95'
							onClick={handleProcessFile}
						>
							1) Procesar archivo
						</button>

						{previewRows.length > 0 && (
							<div className='text-[11px] text-neutral-400'>
								{previewRows.length} filas válidas listas para importar.
							</div>
						)}

						{excludedRows.length > 0 && (
							<div className='bg-red-950/20 border border-red-700 rounded-lg p-2 max-h-40 overflow-y-auto'>
								<div className='text-[11px] text-red-400 font-semibold'>
									Filas excluidas ({excludedRows.length}):
								</div>
								<ul className='text-[11px] text-red-400 leading-tight mt-1 space-y-1'>
									{excludedRows.map((ex, i) => (
										<li key={i}>
											#{ex.rowIndex}: {ex.reason}
										</li>
									))}
								</ul>
							</div>
						)}

						<button
							className='bg-emerald-600 text-white rounded-lg px-3 py-2 text-[13px] font-semibold active:scale-95 disabled:opacity-50'
							disabled={importing || previewRows.length === 0}
							onClick={handleImportToSupabase}
						>
							{importing ? 'Importando...' : '2) Importar en Supabase'}
						</button>

						<div className='text-[10px] text-neutral-500 leading-tight'>
							Reglas automáticas:
							<ul className='list-disc list-inside'>
								<li>DNI no se puede repetir en la misma carrera</li>
								<li>chip = "LT" + dorsal padded (00123)</li>
								<li>age_snapshot se setea con edad o default 99</li>
							</ul>
						</div>
					</div>
				</div>

				{/* BLOQUE GESTIÓN / BUSCAR / EDITAR */}
				<div className='bg-neutral-900 border border-neutral-700 rounded-xl p-4 space-y-4'>
					<div className='flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3'>
						<div>
							<div className='text-lg font-semibold text-white'>
								Gestión manual
							</div>
							<div className='text-[11px] text-neutral-500 leading-tight'>
								Alta, edición, baja y recálculo de categoría.
							</div>
						</div>
						<div className='flex-shrink-0'>
							<button
								className='bg-emerald-600 text-white text-[13px] font-semibold rounded-lg px-3 py-2 active:scale-95'
								onClick={openNewParticipant}
							>
								+ Nuevo participante
							</button>
						</div>
					</div>

					<div className='grid gap-3 text-[13px]'>
						{/* Buscador */}
						<div className='flex flex-col'>
							<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
								Buscar (apellido, nombre, DNI, dorsal)
							</div>
							<input
								className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
								placeholder='Ej: GARCIA / 30111222 / 154'
							/>
						</div>

						<button
							className='bg-blue-600 text-white rounded-lg px-3 py-2 text-[13px] font-semibold active:scale-95'
							onClick={handleAssignCategories}
						>
							Recalcular categorías
						</button>

						<div className='text-[10px] text-neutral-500 leading-tight'>
							Usa las categorías ACTIVAS de esta carrera. Match por distancia,
							sexo y rango de edad. Si no tiene edad o distancia, no se asigna.
						</div>
					</div>

					{/* === RESULTADOS BUSQUEDA - MOBILE CARDS (<sm) === */}
					<div className='sm:hidden flex flex-col gap-3 max-h-64 overflow-y-auto'>
						{filteredParticipants.length === 0 ? (
							<div className='text-center text-neutral-500 text-[12px] py-4 border border-neutral-700 bg-neutral-950 rounded-xl'>
								Sin resultados.
							</div>
						) : (
							filteredParticipants.map((p, idx) => (
								<div
									key={p.id}
									role='button'
									tabIndex={0}
									onClick={() => router.push(getParticipantDetailPath(p.id))}
									onKeyDown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											router.push(getParticipantDetailPath(p.id));
										}
									}}
									className={`rounded-xl border border-neutral-700 ${
										idx % 2 === 0 ? 'bg-neutral-900' : 'bg-neutral-950/40'
									} p-3 text-[13px] text-neutral-200 cursor-pointer hover:bg-neutral-900/70 transition`}
									aria-label='Ver detalle de participante'
								>
									<div className='flex flex-wrap justify-between gap-x-2 gap-y-1'>
										<div className='font-semibold text-white leading-tight'>
											<button
												className='bg-blue-600 px-3 py-1.5 rounded-md text-white font-semibold active:scale-95'
												onClick={(e) => {
													e.stopPropagation();
													router.push(getParticipantDetailPath(p.id));
												}}
											>
												{p.last_name}, {p.first_name}
											</button>
										</div>
										<div className='text-right text-neutral-300'>
											Dorsal:{' '}
											<span className='text-white font-semibold'>
												{p.bib_number ?? '—'}
											</span>
										</div>
									</div>

									<div className='grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-[12px]'>
										<div className='text-neutral-400'>DNI</div>
										<div className='text-neutral-200'>{p.dni}</div>

										<div className='text-neutral-400'>Distancia</div>
										<div className='text-neutral-200'>
											{p.distance_km != null ? `${p.distance_km}K` : '—'}
										</div>

										<div className='text-neutral-400'>Cat.</div>
										<div className='text-neutral-200'>
											{p.category && p.category.name ? p.category.name : '—'}
										</div>
									</div>

									{/* Acciones: Ver (primario), Editar, Borrar.
                      stopPropagation para no disparar el onClick del card */}
									<div className='flex flex-wrap justify-end gap-3 mt-3 text-[12px]'>
										<button
											className='bg-blue-600 px-3 py-1.5 rounded-md text-white font-semibold active:scale-95'
											onClick={(e) => {
												e.stopPropagation();
												router.push(getParticipantDetailPath(p.id));
											}}
										>
											Ver
										</button>
										<button
											className='text-emerald-400 underline active:scale-95'
											onClick={(e) => {
												e.stopPropagation();
												openEditParticipant(p);
											}}
										>
											Editar
										</button>
										<button
											className='text-red-400 underline active:scale-95'
											onClick={(e) => {
												e.stopPropagation();
												handleDeleteParticipant(p);
											}}
										>
											Borrar
										</button>
									</div>
								</div>
							))
						)}
					</div>

					{/* === RESULTADOS BUSQUEDA - TABLA DESKTOP (>=sm) === */}
					<div className='hidden sm:block border border-neutral-700 bg-neutral-950 rounded-xl overflow-hidden max-h-64 overflow-y-auto'>
						<table className='min-w-full text-left text-sm text-neutral-200'>
							<thead className='bg-neutral-800 text-[11px] uppercase text-neutral-400'>
								<tr>
									<th className='px-3 py-2 whitespace-nowrap'>
										Apellido, Nombre
									</th>
									<th className='px-3 py-2 whitespace-nowrap'>DNI</th>
									<th className='px-3 py-2 whitespace-nowrap'>Dist</th>
									<th className='px-3 py-2 whitespace-nowrap'>Dorsal</th>
									<th className='px-3 py-2 whitespace-nowrap'>Cat.</th>
									<th className='px-3 py-2 whitespace-nowrap text-right'>
										Acciones
									</th>
								</tr>
							</thead>
							<tbody>
								{filteredParticipants.length === 0 ? (
									<tr>
										<td
											colSpan={6}
											className='px-3 py-4 text-center text-neutral-500 text-[12px]'
										>
											Sin resultados.
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
											<td className='px-3 py-2 text-[13px] text-white font-semibold leading-tight'>
												{p.last_name}, {p.first_name}
												<div className='text-[10px] text-neutral-500 leading-tight'>
													#{p.id}
												</div>
											</td>
											<td className='px-3 py-2 text-[13px] text-neutral-300'>
												{p.dni}
											</td>
											<td className='px-3 py-2 text-[13px] text-neutral-300'>
												{p.distance_km != null ? `${p.distance_km}K` : '—'}
											</td>
											<td className='px-3 py-2 text-[13px] text-neutral-300'>
												{p.bib_number ?? '—'}
											</td>
											<td className='px-3 py-2 text-[13px] text-neutral-300'>
												{p.category && p.category.name ? p.category.name : '—'}
											</td>
											<td className='px-3 py-2 text-right text-[13px] text-neutral-300'>
												<button
													className='text-blue-400 underline text-[12px] mr-3'
													onClick={() =>
														router.push(getParticipantDetailPath(p.id))
													}
												>
													Detalles
												</button>
												<button
													className='text-emerald-400 underline text-[12px] mr-3'
													onClick={() => openEditParticipant(p)}
												>
													Editar
												</button>
												<button
													className='text-red-400 underline text-[12px]'
													onClick={() => handleDeleteParticipant(p)}
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

					<div className='text-[10px] text-neutral-500 leading-tight'>
						Edición manual te deja corregir edad, distancia, dorsal, etc. O
						borrar inscriptos cargados de más.
					</div>
				</div>
			</div>

			{/* =============================== */}
			{/* NUEVA SECCIÓN: ALERTA SIN CATEGORÍA */}
			{/* =============================== */}
			<section className='mb-10'>
				<div className='bg-neutral-900 border border-neutral-700 rounded-xl overflow-hidden'>
					<div className='bg-neutral-800 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2'>
						<div>
							<div className='text-white font-semibold text-[14px] leading-tight flex items-center gap-2'>
								Sin categoría asignada
								<span className='text-red-400 text-[12px] font-normal'>
									({unassignedParticipants.length})
								</span>
							</div>
							<div className='text-[11px] text-neutral-400 leading-tight'>
								Participantes que todavía no matchean con ninguna categoría
								(edad/distancia/sexo).
							</div>
						</div>
						<div className='flex-shrink-0 flex items-center gap-2'>
							<button
								className='bg-blue-600 text-white text-[12px] font-semibold rounded-lg px-3 py-2 active:scale-95'
								onClick={handleAssignCategories}
							>
								Asignar categorías ahora
							</button>
						</div>
					</div>

					<div className='overflow-x-auto max-h-64 overflow-y-auto'>
						<table className='min-w-full text-left text-sm text-neutral-200'>
							<thead className='bg-neutral-800 text-[11px] uppercase text-neutral-400'>
								<tr>
									<th className='px-3 py-2 whitespace-nowrap'>
										Apellido, Nombre
									</th>
									<th className='px-3 py-2 whitespace-nowrap'>DNI</th>
									<th className='px-3 py-2 whitespace-nowrap'>Sexo</th>
									<th className='px-3 py-2 whitespace-nowrap'>Edad</th>
									<th className='px-3 py-2 whitespace-nowrap'>Dist</th>
									<th className='px-3 py-2 whitespace-nowrap'>Dorsal</th>
									<th className='px-3 py-2 whitespace-nowrap text-right'>
										Acciones
									</th>
								</tr>
							</thead>
							<tbody>
								{unassignedParticipants.length === 0 ? (
									<tr>
										<td
											colSpan={7}
											className='px-3 py-4 text-center text-neutral-500 text-[12px]'
										>
											Todos tienen categoría asignada.
										</td>
									</tr>
								) : (
									unassignedParticipants.map((p, idx) => (
										<tr
											key={p.id}
											className={
												idx % 2 === 0 ? 'bg-neutral-900' : 'bg-neutral-950/40'
											}
										>
											<td className='px-3 py-2 text-[13px] text-white font-semibold leading-tight'>
												{p.last_name}, {p.first_name}
												<div className='text-[10px] text-neutral-500 leading-tight'>
													#{p.id}
												</div>
											</td>
											<td className='px-3 py-2 text-[13px] text-neutral-300'>
												{p.dni}
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
											<td className='px-3 py-2 text-[13px] text-neutral-300'>
												{p.bib_number ?? '—'}
											</td>
											<td className='px-3 py-2 text-right text-[13px] text-neutral-300'>
												<button
													className='text-blue-400 underline text-[12px] mr-3'
													onClick={() =>
														router.push(getParticipantDetailPath(p.id))
													}
												>
													Detalles
												</button>
												<button
													className='text-emerald-400 underline text-[12px] mr-3'
													onClick={() => openEditParticipant(p)}
												>
													Editar
												</button>
												<button
													className='text-red-400 underline text-[12px]'
													onClick={() => handleDeleteParticipant(p)}
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

					<div className='px-4 py-2 text-[10px] text-neutral-500 border-t border-neutral-800'>
						Revisá edad, sexo y distancia. Sin eso no vamos a poder premiar ni
						publicar resultados.
					</div>
				</div>
			</section>

			{/* =============================== */}
			{/* VISTA AGRUPADA POR CATEGORÍA (PODIO / PREMIACIÓN) */}
			{/* =============================== */}
			<section className='mb-24'>
				<h2 className='text-xl font-semibold text-white mb-2'>
					Participantes por categoría
				</h2>
				<div className='text-[11px] text-neutral-500 leading-tight mb-4'>
					Vista operativa para premiación / podio. Agrupado por categoría
					asignada. Ordenado por dorsal.
				</div>

				{Object.keys(participantsByCategory).length === 0 ? (
					<div className='text-neutral-500 text-[12px]'>
						No hay participantes cargados.
					</div>
				) : (
					Object.keys(participantsByCategory)
						.sort((a, b) => {
							// "Sin categoría" al final
							if (a === 'Sin categoría' && b !== 'Sin categoría') return 1;
							if (b === 'Sin categoría' && a !== 'Sin categoría') return -1;
							return a.localeCompare(b);
						})
						.map((catName) => {
							const list = participantsByCategory[catName];

							return (
								<div
									key={catName}
									className='mb-6 bg-neutral-900 border border-neutral-700 rounded-xl overflow-hidden'
								>
									<div className='bg-neutral-800 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2'>
										<div>
											<div className='text-white font-semibold text-[14px] leading-tight'>
												{catName}
											</div>
											<div className='text-[11px] text-neutral-400 leading-tight'>
												{list.length} participante
												{list.length === 1 ? '' : 's'}
											</div>
										</div>
									</div>

									<div className='overflow-x-auto'>
										<table className='min-w-full text-left text-sm text-neutral-200'>
											<thead className='bg-neutral-800 text-[11px] uppercase text-neutral-400'>
												<tr>
													<th className='px-3 py-2 whitespace-nowrap'>#</th>
													<th className='px-3 py-2 whitespace-nowrap'>
														Dorsal
													</th>
													<th className='px-3 py-2 whitespace-nowrap'>
														Apellido, Nombre
													</th>
													<th className='px-3 py-2 whitespace-nowrap'>DNI</th>
													<th className='px-3 py-2 whitespace-nowrap'>Sexo</th>
													<th className='px-3 py-2 whitespace-nowrap'>Edad</th>
													<th className='px-3 py-2 whitespace-nowrap'>
														Distancia
													</th>
												</tr>
											</thead>
											<tbody>
												{list.map((p, idx) => (
													<tr
														key={p.id}
														className={
															idx % 2 === 0
																? 'bg-neutral-900'
																: 'bg-neutral-950/40'
														}
													>
														<td className='px-3 py-2 text-[13px] text-neutral-400'>
															{idx + 1}
														</td>
														<td className='px-3 py-2 text-[13px] text-white font-semibold'>
															{p.bib_number ?? '—'}
														</td>
														<td className='px-3 py-2 text-[13px] text-neutral-200'>
															{p.last_name}, {p.first_name}
														</td>
														<td className='px-3 py-2 text-[13px] text-neutral-300'>
															{p.dni}
														</td>
														<td className='px-3 py-2 text-[13px] text-neutral-300'>
															{p.sex}
														</td>
														<td className='px-3 py-2 text-[13px] text-neutral-300'>
															{p.age != null ? p.age : '—'}
														</td>
														<td className='px-3 py-2 text-[13px] text-neutral-300'>
															{p.distance_km != null
																? `${p.distance_km}K`
																: '—'}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>

									<div className='px-4 py-2 text-[10px] text-neutral-500 border-t border-neutral-800'>
										Nota operativa: cuando tengamos tiempos finales, acá vamos a
										poder listar posiciones y podio.
									</div>
								</div>
							);
						})
				)}
			</section>

			{/* MODAL ALTA / EDICIÓN PARTICIPANTE */}
			{editModalOpen && (
				<div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto'>
					<div className='w-full max-w-lg bg-neutral-900 border border-neutral-700 rounded-2xl p-4 text-white'>
						<div className='flex items-start justify-between mb-3'>
							<div>
								<div className='text-lg font-semibold'>
									{editMode === 'new'
										? 'Nuevo participante'
										: 'Editar participante'}
								</div>
								<div className='text-[11px] text-neutral-500 leading-tight'>
									DNI único por carrera. Edad o Fecha de nacimiento obligatoria.
								</div>
							</div>
							<button
								className='text-neutral-400 text-sm'
								onClick={() => {
									if (!savingParticipant) setEditModalOpen(false);
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
							<div className='flex flex-col'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Apellido *
								</div>
								<input
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={formLastName}
									onChange={(e) => setFormLastName(e.target.value)}
								/>
							</div>

							<div className='flex flex-col'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Nombre *
								</div>
								<input
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={formFirstName}
									onChange={(e) => setFormFirstName(e.target.value)}
								/>
							</div>

							<div className='flex flex-col'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									DNI *
								</div>
								<input
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={formDni}
									onChange={(e) => setFormDni(e.target.value)}
								/>
							</div>

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
								</select>
							</div>

							<div className='flex flex-col'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Distancia (km) *
								</div>
								<input
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={formDistance}
									onChange={(e) => setFormDistance(e.target.value)}
									placeholder='Ej: 5 / 10 / 21'
								/>
							</div>

							<div className='flex flex-col'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Dorsal
								</div>
								<input
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={formBib}
									onChange={(e) => setFormBib(e.target.value)}
									placeholder='Ej: 152'
								/>
								<div className='text-[10px] text-neutral-500 mt-1'>
									El chip se genera automático (LT00000).
								</div>
							</div>

							<div className='flex flex-col'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Fecha nacimiento
								</div>
								<input
									type='date'
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={formBirthDate}
									onChange={(e) => setFormBirthDate(e.target.value)}
								/>
							</div>

							<div className='flex flex-col'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Edad
								</div>
								<input
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={formAge}
									onChange={(e) => setFormAge(e.target.value)}
									placeholder='Ej: 34'
								/>
							</div>

							<div className='flex flex-col col-span-2'>
								<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
									Estado
								</div>
								<select
									className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
									value={formStatus}
									onChange={(e) => setFormStatus(e.target.value)}
								>
									<option value='registered'>registered</option>
									<option value='dns'>dns (no largó)</option>
									<option value='dnf'>dnf (no terminó)</option>
									<option value='finished'>finished</option>
								</select>
							</div>
						</div>

						<div className='flex flex-col sm:flex-row-reverse sm:justify-end gap-3 mt-4'>
							<button
								className='bg-emerald-600 text-white font-semibold text-sm px-4 py-2 rounded-lg active:scale-95 disabled:opacity-50'
								disabled={savingParticipant}
								onClick={handleSaveParticipant}
							>
								{savingParticipant ? 'Guardando...' : 'Guardar'}
							</button>
							<button
								className='bg-neutral-800 text-white border border-neutral-600 font-semibold text-sm px-4 py-2 rounded-lg active:scale-95 disabled:opacity-50'
								disabled={savingParticipant}
								onClick={() => setEditModalOpen(false)}
							>
								Cancelar
							</button>
						</div>

						<div className='text-[10px] text-neutral-600 mt-3 leading-tight'>
							Recordá volver a "Recalcular categorías" si cambiaste
							edad/distancia/sexo.
						</div>
					</div>
				</div>
			)}
		</main>
	);
}

// Componente para el mapeo de columnas en importación
function ColumnMapper({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
}) {
	return (
		<div className='flex flex-col text-[13px]'>
			<div className='text-[11px] text-neutral-400 uppercase tracking-wide'>
				{label}
			</div>
			<input
				className='rounded-lg bg-neutral-800 border border-neutral-600 px-2 py-2 text-[13px] text-white'
				value={value}
				onChange={(e) => onChange(e.target.value)}
			/>
			<div className='text-[10px] text-neutral-500 leading-tight mt-1'>
				Nombre EXACTO de la columna en tu archivo.
			</div>
		</div>
	);
}
