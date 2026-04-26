import React from 'react';
import { Redirect } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';

/**
 * Site root — there is no separate marketing/landing page; readers always want
 * the architecture overview. Redirect them there. The Architecture doc itself
 * acts as the landing page (Context diagram + sidebar to everything else).
 */
export default function Home(): React.ReactElement {
  return <Redirect to={useBaseUrl('/docs/architecture/')} />;
}
