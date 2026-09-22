/** Editor uses full-bleed tool chrome — skip padding from parent content rhythm. */
export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return <div className="-mt-0">{children}</div>;
}
