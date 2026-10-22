/** Fixed, decorative background: two parallax layers of drifting light, film grain and a vignette (pure CSS). */
export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop__layer backdrop__layer--far" />
      <div className="backdrop__layer backdrop__layer--near" />
      <div className="backdrop__grain" />
      <div className="backdrop__vignette" />
    </div>
  );
}
