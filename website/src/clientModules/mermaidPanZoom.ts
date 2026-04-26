/**
 * Wrap every rendered Mermaid SVG with svg-pan-zoom so the larger generated
 * graphs are navigable. Loaded by Docusaurus on every page.
 *
 * Strategy: observe DOM mutations (Mermaid renders async after the page mounts);
 * for each newly inserted Mermaid container, attach pan/zoom. svg-pan-zoom is
 * loaded lazily via dynamic import the first time we encounter a diagram.
 */

import type ExecutionEnvironment from '@docusaurus/ExecutionEnvironment';

const MERMAID_SELECTOR = '.docusaurus-mermaid-container svg';
const PROCESSED_ATTR = 'data-pan-zoom-bound';

type SvgPanZoomLib = typeof import('svg-pan-zoom');
type SvgPanZoomModule = SvgPanZoomLib | { default: SvgPanZoomLib };

let svgPanZoomPromise: Promise<SvgPanZoomLib> | null = null;
function loadSvgPanZoom(): Promise<SvgPanZoomLib> {
  svgPanZoomPromise ??= import('svg-pan-zoom').then((m: SvgPanZoomModule) =>
    'default' in m ? m.default : m,
  );
  return svgPanZoomPromise;
}

async function bind(svg: SVGSVGElement) {
  if (svg.getAttribute(PROCESSED_ATTR) === 'true') return;
  svg.setAttribute(PROCESSED_ATTR, 'true');
  let svgPanZoom: SvgPanZoomLib;
  try {
    svgPanZoom = await loadSvgPanZoom();
  } catch {
    svg.removeAttribute(PROCESSED_ATTR);
    return;
  }
  // svg-pan-zoom requires explicit width/height; Mermaid sets these but in
  // some viewport sizes the SVG is auto-sized via CSS. Force a fixed width
  // so pan/zoom has something to work with.
  if (!svg.getAttribute('width')) svg.setAttribute('width', '100%');
  if (!svg.getAttribute('height')) svg.setAttribute('height', '500');
  svgPanZoom(svg, {
    zoomEnabled: true,
    controlIconsEnabled: true,
    fit: true,
    center: true,
    minZoom: 0.2,
    maxZoom: 10,
  });
}

function scan() {
  document.querySelectorAll<SVGSVGElement>(MERMAID_SELECTOR).forEach((svg) => {
    void bind(svg);
  });
}

let observer: MutationObserver | null = null;

function start() {
  if (typeof window === 'undefined') return;
  scan();
  observer?.disconnect();
  observer = new MutationObserver(() => scan());
  observer.observe(document.body, { childList: true, subtree: true });
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'complete' || document.readyState === 'interactive') start();
  else window.addEventListener('DOMContentLoaded', start);
}

// Re-bind after Docusaurus client-side route transitions complete.
export function onRouteDidUpdate(): void {
  if (typeof window === 'undefined') return;
  // Mermaid re-renders async; give it a beat.
  window.setTimeout(scan, 100);
}

// Type-only re-export to satisfy TS isolatedModules.
export type _ExecEnv = typeof ExecutionEnvironment;
