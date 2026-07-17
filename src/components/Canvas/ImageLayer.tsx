import { useEffect, useState } from 'react';
import { Image as KonvaImage, Layer } from 'react-konva';

interface Props {
  src: string;
  fitX: number;
  fitY: number;
  fitScale: number;
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * Renders a raster image as the background floor-plan layer.
 * The image is already fitted to the viewport – fitX/fitY/fitScale are
 * computed once (on import) and stored in the background state so that
 * calibration coordinates stay consistent.
 */
export default function ImageLayer({ src, fitX, fitY, fitScale, naturalWidth, naturalHeight }: Props) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const image = new window.Image();
    image.src = src;
    image.onload = () => setImg(image);
    return () => {
      image.onload = null;
    };
  }, [src]);

  if (!img) return <Layer listening={false} />;

  return (
    <Layer listening={false}>
      <KonvaImage
        image={img}
        x={fitX}
        y={fitY}
        width={naturalWidth * fitScale}
        height={naturalHeight * fitScale}
        opacity={0.85}
      />
    </Layer>
  );
}
