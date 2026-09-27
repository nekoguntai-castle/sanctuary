import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
const backend = vi.hoisted(() => ({ enabled: true, me: vi.fn(), disable: vi.fn(), enable: vi.fn(), setup: vi.fn() }));
vi.mock('../../../src/api/auth', async importOriginal => ({ ...await importOriginal(), getCurrentUser: backend.me }));
vi.mock('../../../src/api/twoFactor', async importOriginal => ({ ...await importOriginal(),
  setup2FA: backend.setup,
  disable2FA: backend.disable, enable2FA: backend.enable,
}));
vi.mock('../../../src/contexts/useUserTheme', () => ({ useUserTheme: () => {} }));
import { UserProvider, useUser } from '../../../src/contexts/UserContext';
import { Account } from '../../../src/components/Account';
function Shell() {
 const { isLoading, isAuthenticated } = useUser();
 if (isLoading) return <div>Bootstrapping</div>;
 if (!isAuthenticated) return <div>Login</div>;
 return <><Link to='/dashboard'>Go dashboard</Link><Link to='/account'>Go account</Link><Routes>
 <Route path='/account' element={<Account />} /><Route path='/dashboard' element={<div>Dashboard route</div>} />
 </Routes></>;
}
beforeEach(() => {
 vi.clearAllMocks();
 backend.setup.mockResolvedValue({ secret: 'secret', qrCodeDataUrl: 'data:image/png;base64,eA==' });
 backend.me.mockImplementation(async () => ({ id:'u1',username:'alice',isAdmin:false,createdAt:'2026-01-01',preferences:{},twoFactorEnabled:backend.enabled }));
 backend.disable.mockImplementation(async () => { backend.enabled=false; return {success:true}; });
 backend.enable.mockImplementation(async () => { backend.enabled=true; return {success:true,backupCodes:['backup-one']}; });
});
describe('actual Account route remount retains backend 2FA truth', () => {
 it.each([true,false])('initial enabled=%s, mutate then navigate away/back', async initial => {
 backend.enabled=initial;
 render(<MemoryRouter initialEntries={['/account']}><UserProvider><Shell /></UserProvider></MemoryRouter>);
 await screen.findByText(initial ? '2FA Enabled' : '2FA Disabled');
 if(initial) {
  fireEvent.click(screen.getByRole('button',{name:'Disable'}));
  fireEvent.change(screen.getByPlaceholderText('Enter your password'),{target:{value:'password'}});
  fireEvent.change(screen.getByPlaceholderText('000000'),{target:{value:'123456'}});
  fireEvent.click(screen.getByRole('button',{name:'Disable 2FA'}));
 } else {
  fireEvent.click(screen.getByRole('button',{name:'Enable 2FA'}));
  await screen.findByPlaceholderText('000000');
  fireEvent.change(screen.getByPlaceholderText('000000'),{target:{value:'123456'}});
  fireEvent.click(screen.getByRole('button',{name:'Verify and Enable 2FA'}));
 }
 await screen.findByText(initial ? '2FA Disabled' : '2FA Enabled');
 if(!initial) fireEvent.click(screen.getByRole('button',{name:"I've Saved My Codes"}));
 expect(backend.enabled).toBe(!initial);
 fireEvent.click(screen.getByRole('link',{name:'Go dashboard'}));
 await screen.findByText('Dashboard route');
 fireEvent.click(screen.getByRole('link',{name:'Go account'}));
 await screen.findByText('Account Settings');
 expect(backend.me).toHaveBeenCalledTimes(1);
 expect(screen.queryByText(initial ? '2FA Disabled' : '2FA Enabled')).not.toBeNull();
 });

 it.each(['success', 'error'] as const)('keeps one provider request across pending remount and %s', async outcome => {
  backend.enabled = true;
  let resolve!: (value: { success: boolean }) => void;
  let reject!: (error: Error) => void;
  backend.disable.mockReturnValueOnce(new Promise<{success:boolean}>((yes, no) => { resolve=yes; reject=no; }));
  render(<MemoryRouter initialEntries={['/account']}><UserProvider><Shell /></UserProvider></MemoryRouter>);
  await screen.findByText('2FA Enabled');
  const submit = () => {
   fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
   fireEvent.change(screen.getByPlaceholderText('Enter your password'), {target:{value:'password'}});
   fireEvent.change(screen.getByPlaceholderText('000000'), {target:{value:'123456'}});
   fireEvent.click(screen.getByRole('button', { name: 'Disable 2FA' }));
  };
  submit();
  fireEvent.click(screen.getByRole('link',{name:'Go dashboard'}));
  await screen.findByText('Dashboard route');
  fireEvent.click(screen.getByRole('link',{name:'Go account'}));
  await screen.findByText('Account Settings');
  submit();
  await waitFor(() => expect(screen.getByRole('button', {name:'Disable 2FA'})).not.toBeDisabled());
  expect(backend.disable).toHaveBeenCalledTimes(1);
  if(outcome === 'success') {
   await act(async () => { backend.enabled=false; resolve({success:true}); });
   expect(await screen.findByText('2FA Disabled')).toBeInTheDocument();
  } else {
   await act(async () => { reject(new Error('old failure')); });
   expect(screen.getByText('2FA Enabled')).toBeInTheDocument();
   expect(screen.queryByText('Failed to disable 2FA')).not.toBeInTheDocument();
   expect(screen.queryByText('old failure')).not.toBeInTheDocument();
   fireEvent.click(screen.getByRole('button',{name:'Disable 2FA'}));
   expect(await screen.findByText('2FA Disabled')).toBeInTheDocument();
   expect(backend.disable).toHaveBeenCalledTimes(2);
  }
 });

 it.each(['success', 'error'] as const)('settles enable %s while Account is departed without restoring its secret modal', async outcome => {
  backend.enabled = false;
  let resolve!: (value: {success:boolean;backupCodes:string[]}) => void;
  let reject!: (error: Error) => void;
  backend.enable.mockReturnValueOnce(new Promise<{success:boolean;backupCodes:string[]}>((yes, no) => {resolve=yes; reject=no;}));
  render(<MemoryRouter initialEntries={['/account']}><UserProvider><Shell /></UserProvider></MemoryRouter>);
  await screen.findByText('2FA Disabled');
  fireEvent.click(screen.getByRole('button',{name:'Enable 2FA'}));
  await screen.findByPlaceholderText('000000');
  fireEvent.change(screen.getByPlaceholderText('000000'),{target:{value:'123456'}});
  fireEvent.click(screen.getByRole('button',{name:'Verify and Enable 2FA'}));
  fireEvent.click(screen.getByRole('link',{name:'Go dashboard'}));
  await screen.findByText('Dashboard route');
  await act(async () => {
   if(outcome === 'success') { backend.enabled=true;resolve({success:true,backupCodes:['departed-secret']}); }
   else reject(new Error('departed enable failed'));
  });
  fireEvent.click(screen.getByRole('link',{name:'Go account'}));
  expect(await screen.findByText(outcome === 'success' ? '2FA Enabled' : '2FA Disabled')).toBeInTheDocument();
  expect(screen.queryByText('Invalid verification code')).not.toBeInTheDocument();
  expect(screen.queryByText('departed enable failed')).not.toBeInTheDocument();
  expect(screen.queryByText('departed-secret')).not.toBeInTheDocument();
  expect(screen.queryByText('Save Backup Codes')).not.toBeInTheDocument();
 });

 it('rejects remounted duplicate enable without exposing original backup codes there', async () => {
  backend.enabled = false;
  let resolve!: (value: {success:boolean;backupCodes:string[]}) => void;
  backend.enable.mockReturnValueOnce(new Promise<{success:boolean;backupCodes:string[]}>(yes => { resolve=yes; }));
  render(<MemoryRouter initialEntries={['/account']}><UserProvider><Shell /></UserProvider></MemoryRouter>);
  await screen.findByText('2FA Disabled');
  const submit = async () => {
   fireEvent.click(screen.getByRole('button',{name:'Enable 2FA'}));
   await screen.findByPlaceholderText('000000');
   fireEvent.change(screen.getByPlaceholderText('000000'),{target:{value:'123456'}});
   fireEvent.click(screen.getByRole('button',{name:'Verify and Enable 2FA'}));
  };
  await submit();
  fireEvent.click(screen.getByRole('link',{name:'Go dashboard'}));
  await screen.findByText('Dashboard route');
  fireEvent.click(screen.getByRole('link',{name:'Go account'}));
  await screen.findByText('Account Settings');
  await submit();
  await waitFor(() => expect(screen.getByRole('button',{name:'Verify and Enable 2FA'})).not.toBeDisabled());
  expect(backend.enable).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Save Backup Codes')).not.toBeInTheDocument();
  await act(async () => { backend.enabled=true; resolve({success:true,backupCodes:['original-only-secret']}); });
  expect(await screen.findByText('2FA Enabled')).toBeInTheDocument();
  expect(screen.queryByText('original-only-secret')).not.toBeInTheDocument();
 });
});

it.each(['double-click', 'background-setup-success', 'background-setup-error'] as const)(
  'rapid duplicate %s preserves first codes',
  async mode => {
    backend.enabled = false;
    let resolve!: (value: { success: boolean; backupCodes: string[] }) => void;
    backend.enable.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/account']}><UserProvider><Shell /></UserProvider></MemoryRouter>);
    await screen.findByText('2FA Disabled');
    await user.click(screen.getByRole('button', { name: 'Enable 2FA' }));
    await user.type(await screen.findByPlaceholderText('000000'), '123456');
    const verify = screen.getByRole('button', { name: 'Verify and Enable 2FA' });
    await user.dblClick(verify);
    expect(backend.enable).toHaveBeenCalledTimes(1);
    expect(verify).toBeDisabled();

    if (mode !== 'double-click') {
      if (mode === 'background-setup-error') {
        backend.setup.mockRejectedValueOnce(new Error('2FA is already enabled'));
      }
      // The existing modal does not trap focus: reach the background action by keyboard.
      const background = screen.getByRole('button', { name: 'Enable 2FA' });
      for (let i = 0; i < 30 && document.activeElement !== background; i++) await user.tab();
      expect(document.activeElement).toBe(background);
      await user.keyboard('{Enter}');
      await waitFor(() => expect(verify).not.toBeDisabled());
      await user.click(verify);
      expect(backend.enable).toHaveBeenCalledTimes(1);
    }

    await act(async () => {
      backend.enabled = true;
      resolve({ success: true, backupCodes: ['first-codes'] });
    });
    expect(await screen.findByText('first-codes')).toBeInTheDocument();
  },
);
