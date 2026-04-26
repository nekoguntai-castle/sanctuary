import React from 'react';
import { Redirect } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';

/**
 * Site root — there is no separate marketing/landing page; readers always want
 * the architecture overview. Redirect them there. The Architecture doc itself
 * acts as the landing page (Context diagram + sidebar to everything else).
 */
export default function Home(): React.ReactElement {
  // No trailing slash — site config sets `trailingSlash: false`, so the
  // canonical URL is `/docs/architecture` and the build produces
  // `architecture.html`, not `architecture/index.html`.
  return <Redirect to={useBaseUrl('/docs/architecture')} />;
}
