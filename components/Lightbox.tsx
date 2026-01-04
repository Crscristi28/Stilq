import { X } from 'lucide-react';

interface LightboxProps {
  src: string | null;
  onClose: () => void;
}

export const Lightbox = ({ src, onClose }: LightboxProps) => {
  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 text-white/70 hover:text-white transition-colors"
      >
        <X size={28} />
      </button>
      <img
        src={src}
        alt="Fullscreen view"
        className="max-w-[95vw] max-h-[95vh] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
};
