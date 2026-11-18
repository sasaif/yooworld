import { Q } from './quality';
/** Warm, cheap lighting: hemisphere fill + one shadow-casting sun + a few short-range lamps. */
export function Lighting({ center }: { center: [number, number, number] }) {
  const [cx, , cz] = center;
  return (
    <>
      <hemisphereLight args={['#fff1e0', '#a184bf', 1.05]} />
      <ambientLight color="#ffd9c2" intensity={0.12} />
      <directionalLight position={[cx + 3, 8, cz + 4.5]} intensity={2.3} color="#ffd9ae" castShadow
        shadow-mapSize={[Q.shadowMap, Q.shadowMap]} shadow-bias={-0.0005} shadow-normalBias={0.02}
        shadow-radius={4} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} />
      <directionalLight position={[-4, 5, 8]} intensity={0.45} color="#d9e4ff" />
    </>
  );
}
