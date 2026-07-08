"use client";

/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";

const MAX_BYTES = 500 * 1024; // ~500KB — plenty for a logo or signature PNG

/**
 * Upload an image from the device. The file is read into a data URL and stored
 * in a hidden input of the given `name`, so it saves with the surrounding form
 * (no external hosting needed). Shows a live preview and a Remove button.
 */
export function ImageUploadField({
  name,
  initial,
  label,
  hint,
  previewClass = "h-16",
  previewBg = "bg-canvas",
}: {
  name: string;
  initial?: string | null;
  label: string;
  hint?: string;
  previewClass?: string;
  previewBg?: string;
}) {
  const [value, setValue] = useState<string>(initial ?? "");
  const [error, setError] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (PNG, JPG or SVG).");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image is too large — please keep it under 500KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setValue(String(reader.result || ""));
    reader.onerror = () => setError("Couldn't read that file. Try another.");
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <span className="label">{label}</span>
      <input type="hidden" name={name} value={value} />
      <div className="flex items-center gap-4">
        <div className={`grid ${previewClass} w-28 place-items-center overflow-hidden rounded-lg border border-line ${previewBg}`}>
          {value ? (
            <img src={value} alt="" className="max-h-full max-w-full object-contain p-1" />
          ) : (
            <span className="text-[11px] text-muted">No image</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} className="btn-ghost btn-sm">
              {value ? "Change" : "Upload"}
            </button>
            {value && (
              <button type="button" onClick={() => setValue("")} className="btn-ghost btn-sm text-red-600">
                Remove
              </button>
            )}
          </div>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
