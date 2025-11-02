// ESTE ARCHIVO NO LLEVA "use client"
// Es el entrypoint de la ruta dinámica.
// Su único trabajo es tomar los params (que vienen como Promise en tu versión de Next)
// y pasarlos como props planas al componente cliente real.

import ParticipantDetailClient from './ParticipantDetailClient';

export default async function Page({
	params,
}: {
	params: Promise<{ raceId: string; participantId: string }>;
}) {
	// Next en tu build devuelve params como Promise -> lo resolvemos acá
	const { raceId, participantId } = await params;

	return (
		<ParticipantDetailClient raceId={raceId} participantId={participantId} />
	);
}
