import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { HardwareDevice } from '../../types';
import { getDeviceIcon } from '../ui/CustomIcons';
import { Edit2, Save, X, ArrowLeft, ChevronDown, Users, Shield, Plus } from 'lucide-react';
import { TransferOwnershipModal } from '../TransferOwnershipModal';
import { getAccountTypeInfo } from './accountTypes';
import { useDeviceData } from './hooks/useDeviceData';
import { DetailsTab } from './tabs/DetailsTab';
import { AccessTab } from './tabs/AccessTab';
import { AddAccountFlow } from './accounts/AddAccountFlow';

type TabType = 'details' | 'access';

export const DeviceDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [showAddAccount, setShowAddAccount] = useState(false);

  const {
    device,
    setDevice,
    wallets,
    loading,
    user,
    isEditing,
    setIsEditing,
    editLabel,
    setEditLabel,
    editModelSlug,
    setEditModelSlug,
    deviceModels,
    showTransferModal,
    setShowTransferModal,
    deviceShareInfo,
    groups,
    selectedGroupToAdd,
    setSelectedGroupToAdd,
    userSearchQuery,
    userSearchResults,
    searchingUsers,
    sharingLoading,
    isOwner,
    userRole,
    handleSave,
    cancelEdit,
    handleSearchUsers,
    handleShareWithUser,
    handleRemoveUserAccess,
    addGroup,
    removeGroup,
    handleTransferComplete,
    getDeviceDisplayName,
  } = useDeviceData(id);

  if (loading) return <div className="p-8 text-center text-sanctuary-400">Loading device...</div>;
  if (!device) return <div className="p-8 text-center text-sanctuary-400">Device not found.</div>;

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
        <button
          onClick={() => navigate('/devices')}
          className="flex items-center text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Devices
        </button>

        <div className="surface-elevated rounded-2xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
            <div className="flex items-start space-x-6">
                <div className="p-4 rounded-2xl surface-secondary text-sanctuary-600 dark:text-sanctuary-300">
                    {getDeviceIcon(device.type as HardwareDevice, "w-12 h-12")}
                </div>
                <div className="flex-1">
                    <div className="flex items-center justify-between">
                         <div>
                            <div className="flex items-center space-x-2">
                                {isEditing ? (
                                    <div className="flex items-center space-x-2">
                                        <input
                                            value={editLabel}
                                            onChange={e => setEditLabel(e.target.value)}
                                            className="px-2 py-1 border border-sanctuary-300 dark:border-sanctuary-700 rounded surface-muted text-xl font-light focus:outline-none"
                                        />
                                        <button onClick={handleSave} className="p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded transition-colors" aria-label="Save label"><Save className="w-5 h-5" /></button>
                                        <button onClick={cancelEdit} className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded transition-colors" aria-label="Cancel editing"><X className="w-5 h-5" /></button>
                                    </div>
                                ) : (
                                    <>
                                        <h1 className="text-3xl font-light text-sanctuary-900 dark:text-sanctuary-50">{device.label}</h1>
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                          userRole === 'owner' ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' :
                                          'bg-sanctuary-100 text-sanctuary-700 dark:bg-sanctuary-700 dark:text-sanctuary-300'
                                        }`}>
                                          {userRole === 'owner' ? 'Owner' : 'Viewer'}
                                        </span>
                                        {isOwner && (
                                          <button onClick={() => setIsEditing(true)} className="text-sanctuary-400 hover:text-sanctuary-600 p-1" aria-label="Edit label"><Edit2 className="w-4 h-4" /></button>
                                        )}
                                    </>
                                )}
                            </div>
                            {/* Shared by indicator */}
                            {!isOwner && device.sharedBy && (
                              <span className="text-xs text-sanctuary-400 flex items-center gap-1 mt-1">
                                <Users className="w-3 h-3" />
                                Shared by {device.sharedBy}
                              </span>
                            )}
                            {isEditing ? (
                                <div className="mt-2">
                                    <label className="text-xs text-sanctuary-500 uppercase mb-1 block">Device Type</label>
                                    <div className="relative">
                                        <select
                                            value={editModelSlug}
                                            onChange={e => setEditModelSlug(e.target.value)}
                                            className="w-full px-3 py-2 pr-8 border border-sanctuary-300 dark:border-sanctuary-700 rounded-lg surface-muted text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                                        >
                                            <option value="">Unknown Device</option>
                                            {deviceModels.map(model => (
                                                <option key={model.slug} value={model.slug}>
                                                    {model.manufacturer} {model.name}
                                                </option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-sanctuary-400 pointer-events-none" />
                                    </div>
                                </div>
                            ) : (
                                <p className="text-sanctuary-500 mt-1 text-sm">{getDeviceDisplayName(device.type)}</p>
                            )}
                         </div>
                         <div className="text-right">
                             <div className="text-xs text-sanctuary-400 uppercase tracking-wide">Master Fingerprint</div>
                             <div className="text-xl font-mono text-sanctuary-700 dark:text-sanctuary-300">{device.fingerprint}</div>
                         </div>
                    </div>

                    {/* Device Accounts Section */}
                    <div className="mt-6 pt-6 border-t border-sanctuary-100 dark:border-sanctuary-800">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs text-sanctuary-500 uppercase">Registered Accounts</p>
                        <span className="text-xs text-sanctuary-400">
                          {device.accounts?.length || 1} {(device.accounts?.length || 1) === 1 ? 'account' : 'accounts'}
                        </span>
                      </div>

                      {device.accounts && device.accounts.length > 0 ? (
                        <div className="space-y-3">
                          {device.accounts.map((account) => {
                            const info = getAccountTypeInfo(account);
                            const isMultisig = account.purpose === 'multisig';

                            return (
                              <div
                                key={account.id}
                                className="surface-muted p-4 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800"
                              >
                                <div className="flex items-start justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100 text-sm">
                                      {info.title}
                                    </span>
                                    {info.recommended && (
                                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-medium">
                                        Recommended
                                      </span>
                                    )}
                                  </div>
                                  <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                                    isMultisig
                                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                  }`}>
                                    {isMultisig ? 'Multisig' : 'Single-sig'}
                                  </span>
                                </div>

                                <p className="text-xs text-sanctuary-500 mb-3">
                                  {info.description} <span className="text-sanctuary-400">Addresses: {info.addressPrefix}</span>
                                </p>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                  <div>
                                    <p className="text-[10px] text-sanctuary-400 uppercase mb-1">Derivation Path</p>
                                    <code className="text-xs text-sanctuary-600 dark:text-sanctuary-300 font-mono">
                                      {account.derivationPath}
                                    </code>
                                  </div>
                                  <div className="md:col-span-2">
                                    <p className="text-[10px] text-sanctuary-400 uppercase mb-1">Extended Public Key</p>
                                    <code className="text-[10px] text-sanctuary-600 dark:text-sanctuary-400 break-all font-mono block">
                                      {account.xpub}
                                    </code>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        /* Legacy fallback for devices without accounts array */
                        <div className="surface-muted p-4 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <p className="text-[10px] text-sanctuary-400 uppercase mb-1">Derivation Path</p>
                              <code className="text-xs text-sanctuary-600 dark:text-sanctuary-300 font-mono">
                                {device.derivationPath || "m/84'/0'/0'"}
                              </code>
                            </div>
                            <div className="md:col-span-2">
                              <p className="text-[10px] text-sanctuary-400 uppercase mb-1">Extended Public Key</p>
                              <code className="text-[10px] text-sanctuary-600 dark:text-sanctuary-400 break-all font-mono block">
                                {device.xpub || 'N/A'}
                              </code>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Add Account Button - only for owners */}
                      {isOwner && (
                        <button
                          onClick={() => setShowAddAccount(true)}
                          className="mt-4 flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg border-2 border-dashed border-sanctuary-300 dark:border-sanctuary-700 text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:border-sanctuary-400 dark:hover:border-sanctuary-600 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                          <span className="text-sm font-medium">Add Derivation Path</span>
                        </button>
                      )}

                      {/* Add Account Dialog */}
                      {showAddAccount && (
                        <AddAccountFlow
                          deviceId={id!}
                          device={device}
                          onClose={() => setShowAddAccount(false)}
                          onDeviceUpdated={setDevice}
                        />
                      )}
                    </div>
                </div>
            </div>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-sanctuary-200 dark:border-sanctuary-800">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('details')}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'details'
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:border-sanctuary-300 dark:hover:border-sanctuary-600'
              }`}
            >
              Details
            </button>
            <button
              onClick={() => setActiveTab('access')}
              className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2 ${
                activeTab === 'access'
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:border-sanctuary-300 dark:hover:border-sanctuary-600'
              }`}
            >
              <Shield className="w-4 h-4" />
              Access
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'details' && (
          <DetailsTab wallets={wallets} />
        )}

        {activeTab === 'access' && (
          <AccessTab
            deviceId={id!}
            isOwner={isOwner}
            username={user?.username}
            deviceShareInfo={deviceShareInfo}
            groups={groups}
            selectedGroupToAdd={selectedGroupToAdd}
            setSelectedGroupToAdd={setSelectedGroupToAdd}
            userSearchQuery={userSearchQuery}
            userSearchResults={userSearchResults}
            searchingUsers={searchingUsers}
            sharingLoading={sharingLoading}
            onSearchUsers={handleSearchUsers}
            onShareWithUser={handleShareWithUser}
            onRemoveUserAccess={handleRemoveUserAccess}
            onAddGroup={addGroup}
            onRemoveGroup={removeGroup}
            onTransfer={() => setShowTransferModal(true)}
            onTransferComplete={handleTransferComplete}
          />
        )}

        {/* Transfer Ownership Modal */}
        {showTransferModal && device && (
          <TransferOwnershipModal
            resourceType="device"
            resourceId={device.id}
            resourceName={device.label}
            onClose={() => setShowTransferModal(false)}
            onTransferInitiated={() => {
              setShowTransferModal(false);
              // Could optionally refresh to show the pending transfer
            }}
          />
        )}
    </div>
  );
};
