/** Keep tablet controls and Flow above Safari's on-screen keyboard. */
export function tabletViewportInsets(layoutHeight: number, visualHeight: number, offsetTop: number): { top: number; bottom: number } {
  if (![layoutHeight, visualHeight, offsetTop].every(Number.isFinite)) return { top: 0, bottom: 0 };
  return { top: Math.max(0, offsetTop), bottom: Math.max(0, layoutHeight - visualHeight - Math.max(0, offsetTop)) };
}
export function installTabletViewport(): () => void {
  const viewport = window.visualViewport;
  const update = (): void => {
    const insets = tabletViewportInsets(window.innerHeight, viewport?.height ?? window.innerHeight, viewport?.offsetTop ?? 0);
    document.body.style.setProperty('--pmd-tablet-top', `${insets.top}px`);
    document.body.style.setProperty('--pmd-tablet-bottom', `${insets.bottom}px`);
  };
  window.addEventListener('resize', update); viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update); update();
  return () => { window.removeEventListener('resize', update); viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); };
}
