import { test } from '@playwright/test';
import * as controlVisibility from './render-regression/renderRegressionControlVisibility.contracts';
import * as listEntry from './render-regression/renderRegressionListEntry.contracts';
import * as visualConsistency from './render-regression/renderRegressionVisualConsistency.contracts';

import * as adminTests from './render-regression/renderRegressionAdmin.contracts';
import * as coreTests from './render-regression/renderRegressionCore.contracts';
import * as importAuthTests from './render-regression/renderRegressionImportAuth.contracts';
import { setupRenderRegressionErrorChecks } from './render-regression/renderRegressionHarness';
import * as walletDeviceTests from './render-regression/renderRegressionWalletDevice.contracts';

test.describe('Route-level rendering regressions', () => {
  setupRenderRegressionErrorChecks();
  test.describe('with the balance chart time axis', () => {
    // Paired with the fixed clock these contracts set: tick labels are local
    // hours and dates, so the zone must not follow the host.
    test.use({ timezoneId: 'UTC', locale: 'en-US' });
    test('dashboard renders core cards and network-specific placeholders', coreTests.renderDashboardRendersCoreCardsAndNetworkSpecificPlaceholders);
    test('wallet list renders network-scoped cards and controls', coreTests.renderWalletListRendersNetworkScopedCardsAndControls);
  });
  test('wallet detail renders tab shells and empty-state content', coreTests.renderWalletDetailRendersTabShellsAndEmptyStateContent);
  test('device detail renders add-account flow options without crashing', coreTests.renderDeviceDetailRendersAddAccountFlowOptionsWithoutCrashing);
  test('wallet list route renders first-wallet empty state when no wallets exist', coreTests.renderWalletListRouteRendersFirstWalletEmptyStateWhenNoWalletsExist);
  test('settings route renders tab panels and notification sub-tabs', coreTests.renderSettingsRouteRendersTabPanelsAndNotificationSubTabs);
  test('admin system settings route renders access and websocket panels', adminTests.renderAdminSystemSettingsRouteRendersAccessAndWebsocketPanels);
  test('admin feature flags route renders grouped flags and audit panel', adminTests.renderAdminFeatureFlagsRouteRendersGroupedFlagsAndAuditPanel);
  test('admin node config route renders collapsible sections and key controls', adminTests.renderAdminNodeConfigRouteRendersCollapsibleSectionsAndKeyControls);
  test('admin monitoring route renders service cards and credentials', adminTests.renderAdminMonitoringRouteRendersServiceCardsAndCredentials);
  test('admin monitoring route renders error panel when services API fails', adminTests.renderAdminMonitoringRouteRendersErrorPanelWhenServicesAPIFails);
  test('admin variables route renders system variable controls', adminTests.renderAdminVariablesRouteRendersSystemVariableControls);
  test('admin base route redirects to admin system settings', adminTests.renderAdminBaseRouteRedirectsToAdminSystemSettings);
  test('admin users & groups route renders user and group panels', adminTests.renderAdminUsersAndGroupsRouteRendersUserAndGroupPanels);
  test('admin backup route renders tabs and encryption keys panel', adminTests.renderAdminBackupRouteRendersTabsAndEncryptionKeysPanel);
  test('admin audit logs route renders stats and table shell', adminTests.renderAdminAuditLogsRouteRendersStatsAndTableShell);
  test('admin audit logs route renders error panel when logs API fails', adminTests.renderAdminAuditLogsRouteRendersErrorPanelWhenLogsAPIFails);
  test('admin ai route renders status workflow shell', adminTests.renderAdminAiRouteRendersStatusWorkflowShell);
  test('device list route renders table shell and primary actions', walletDeviceTests.renderDeviceListRouteRendersTableShellAndPrimaryActions);
  test('create wallet route renders topology step and actions', walletDeviceTests.renderCreateWalletRouteRendersTopologyStepAndActions);
  test('create wallet route shows no-compatible-device message for multisig selection', walletDeviceTests.renderCreateWalletRouteShowsNoCompatibleDeviceMessageForMultisigSelection);
  test('create wallet route configuration shows network warning for Testnet3', walletDeviceTests.renderCreateWalletRouteConfigurationShowsNetworkWarningForTestnet3);
  test('send transaction route renders transaction type selection shell', walletDeviceTests.renderSendTransactionRouteRendersTransactionTypeSelectionShell);
  test('send transaction route redirects viewers back to wallet detail', walletDeviceTests.renderSendTransactionRouteRedirectsViewersBackToWalletDetail);
  test('send transaction route renders failure state when wallet fetch returns 500', walletDeviceTests.renderSendTransactionRouteRendersFailureStateWhenWalletFetchReturns500);
  test('send transaction route renders failure state when wallet fetch times out', walletDeviceTests.renderSendTransactionRouteRendersFailureStateWhenWalletFetchTimesOut);
  test('connect device route renders selector and method shells', walletDeviceTests.renderConnectDeviceRouteRendersSelectorAndMethodShells);
  test('connect device route search handles empty results and clear-filters recovery', walletDeviceTests.renderConnectDeviceRouteSearchHandlesEmptyResultsAndClearFiltersRecovery);
  test('connect device route hides usb and qr options when context is not secure', walletDeviceTests.renderConnectDeviceRouteHidesUsbAndQrOptionsWhenContextIsNotSecure);
  test('connect device route renders save failure feedback when API returns 500', walletDeviceTests.renderConnectDeviceRouteRendersSaveFailureFeedbackWhenAPIReturns500);
  test('import wallet route renders format selection options', importAuthTests.renderImportWalletRouteRendersFormatSelectionOptions);
  test('import wallet route renders validation failure feedback when API returns 500', importAuthTests.renderImportWalletRouteRendersValidationFailureFeedbackWhenAPIReturns500);
  test('import wallet descriptor step rejects oversized upload file', importAuthTests.renderImportWalletDescriptorStepRejectsOversizedUploadFile);
  test('import wallet descriptor step rejects invalid upload extension', importAuthTests.renderImportWalletDescriptorStepRejectsInvalidUploadExtension);
  test('import wallet route renders hardware import step shell', importAuthTests.renderImportWalletRouteRendersHardwareImportStepShell);
  test('import wallet route renders qr scan step shell', importAuthTests.renderImportWalletRouteRendersQrScanStepShell);
  test('import wallet hardware step shows HTTPS requirement in insecure context', importAuthTests.renderImportWalletHardwareStepShowsHTTPSRequirementInInsecureContext);
  test('import wallet qr step shows HTTPS camera warning in insecure context', importAuthTests.renderImportWalletQrStepShowsHTTPSCameraWarningInInsecureContext);
  test('account route renders profile, password, and 2fa sections', importAuthTests.renderAccountRouteRendersProfilePasswordAnd2faSections);
  test('admin settings route renders websocket error panel when stats API fails', adminTests.renderAdminSettingsRouteRendersWebsocketErrorPanelWhenStatsAPIFails);
  test('unknown authenticated route redirects to dashboard', importAuthTests.renderUnknownAuthenticatedRouteRedirectsToDashboard);
  test('expired authenticated session redirects to login when /auth/me returns 401', importAuthTests.renderExpiredAuthenticatedSessionRedirectsToLoginWhenAuthMeReturns401);
  test('unauthenticated root route renders login screen', importAuthTests.renderUnauthenticatedRootRouteRendersLoginScreen);

  // The rest of the suite runs at Desktop Chrome's 1280x720. The dashboard's
  // retired two-column row only ever appeared above 1800px, so this is the one
  // width where its return would be visible. Nested so it inherits
  // setupRenderRegressionErrorChecks() from the outer describe.
  test.describe('wide viewport', () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test('dashboard stacks wallets and activity full width at 1920px', coreTests.renderDashboardWideViewportStacksSections);
  });
});

// Registered in the render lane, including the two narrow widths that exposed
// page-wide scrolling. Exact geometry/contrast checks supplement PNG tolerance.
for (const darkMode of [false, true]) {
  for (const width of [1440, 390, 320]) {
    test.describe(`visual consistency ${darkMode ? 'dark' : 'light'} ${width}`, () => {
      test.use({ viewport: { width, height: 1000 } });
      setupRenderRegressionErrorChecks();
      test('selected settings tabs remain readable', ({ page }) => visualConsistency.renderSettingsSelectedContrast(page, darkMode));
      test('wallet settings overflow stays local', ({ page }) => visualConsistency.renderWalletSettingsOverflow(page, darkMode));
      test('device identity and accounts fit the content', ({ page }) => visualConsistency.renderDeviceResponsiveLayout(page, darkMode));
      test('long device labels and multiple accounts stay bounded', ({ page }) => visualConsistency.renderDeviceResponsiveLayout(page, darkMode, true));
      test('relationship navigation supports keyboard and direct entry', ({ page }) => visualConsistency.renderRelationshipKeyboardJourney(page, darkMode));
    });
  }
}

for (const darkMode of [false, true]) {
  for (const width of [1440, 390, 320]) {
    test.describe(`list entry ${darkMode ? 'dark' : 'light'} ${width}`, () => {
      test.use({ viewport: { width, height: 1000 } });
      setupRenderRegressionErrorChecks();
      test('wallet actions fit grid and table', ({ page }) => listEntry.renderWalletListActionsFit(page, darkMode));
      test('wallet cards support keyboard and pointer entry', ({ page }) => listEntry.renderWalletCardEntry(page, darkMode));
      test('grouped device cards separate entry from editing', ({ page }) => listEntry.renderGroupedDeviceEntry(page, darkMode));
    });
  }
}

for (const darkMode of [false, true]) {
  for (const width of [1440, 390, 320]) {
    test.describe(`control visibility ${darkMode ? 'dark' : 'light'} ${width}`, () => {
      test.use({ viewport: { width, height: 1000 } });
      setupRenderRegressionErrorChecks();
      for (const action of ['Generate', 'Cancel'] as const) {
        test(`${action} remains readable on hover`, ({ page }) => controlVisibility.renderGhostActionContrast(page, darkMode, action));
      }
      for (const [receiveCount, changeCount] of [[1, 1], [123, 0]]) {
        test(`address labels and counts remain readable (${receiveCount}/${changeCount})`, ({ page }) => controlVisibility.renderAddressLabelContrast(page, darkMode, receiveCount, changeCount));
      }
      test('Generate fits before hidden ancestors scroll', ({ page }) => controlVisibility.renderAddressGenerateFits(page, darkMode));
      for (const state of ['owned', 'shared', 'empty'] as const) {
        test(`device toolbar fits with ${state} devices`, ({ page }) => controlVisibility.renderDeviceToolbarFits(page, darkMode, state));
      }
    });
  }
}

// The filter menu also needs coverage between the sm control and md shell breakpoints.
for (const darkMode of [false, true]) {
  test.describe(`control visibility ${darkMode ? 'dark' : 'light'} 640`, () => {
    test.use({ viewport: { width: 640, height: 1000 } });
    setupRenderRegressionErrorChecks();
    for (const state of ['owned', 'shared'] as const) {
      test(`device filter menu stays within the toolbar (${state})`, ({ page }) => controlVisibility.renderDeviceToolbarFits(page, darkMode, state));
    }
  });
}
