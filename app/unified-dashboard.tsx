'use client';

import { KeyboardEvent, MouseEvent, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  getFirebaseAuth,
  isFirebaseConfigured,
  signInWithGoogle,
  signOutCurrentUser,
} from './lib/firebase-client';
import WorkspaceV2 from './workspace-v2';
import MonthlyReportTool from './tong-hop-lenh/monthly-tool';
import WeeklyReportTool from './bao-cao-tuan/weekly-tool';
import './unified-tab-fix.css';

export type UnifiedTabId = 'doc-anh' | 'tong-hop-lenh' | 'bao-cao-tuan';

const TABS: Array<{ id: UnifiedTabId; label: string }> = [
  { id: 'doc-anh', label: 'Đọc ảnh' },
  { id: 'tong-hop-lenh', label: 'Tổng hợp lệnh' },
  { id: 'bao-cao-tuan', label: 'Báo cáo tuần' },
];

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

function tabUrl(tabId: UnifiedTabId) {
  return `${BASE_PATH}/?tab=${tabId}`;
}

function tabFromLocation(fallback: UnifiedTabId): UnifiedTabId {
  const value = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((tab) => tab.id === value) ? value as UnifiedTabId : fallback;
}

function authErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  if (code === 'auth/popup-closed-by-user') return 'Cửa sổ đăng nhập đã được đóng trước khi hoàn tất.';
  if (code === 'auth/popup-blocked') return 'Trình duyệt đang chặn cửa sổ đăng nhập Google.';
  if (code === 'auth/unauthorized-domain') return 'Tên miền website chưa được cho phép trong Firebase Authentication.';
  if (code === 'auth/operation-not-allowed') return 'Đăng nhập Google chưa được bật trong Firebase Authentication.';
  return 'Chưa thể đăng nhập Google. Vui lòng thử lại.';
}

function LoginScreen({
  ready,
  busy,
  error,
  onSignIn,
}: {
  ready: boolean;
  busy: boolean;
  error: string;
  onSignIn: () => void;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand"><span aria-hidden="true">S</span><div><strong>SIM Report</strong><small>Stavian Industrial Metal</small></div></div>
        <p className="auth-eyebrow">Không gian báo cáo cá nhân</p>
        <h1 id="auth-title">Đăng nhập để tiếp tục</h1>
        <p className="auth-lead">Mỗi người dùng đăng nhập bằng Google và có cấu hình Gemini API riêng. Dữ liệu của người này không được dùng cho tài khoản khác.</p>
        {error ? <div className="auth-error" role="alert">{error}</div> : null}
        <button className="google-signin" type="button" disabled={!ready || busy || !isFirebaseConfigured} onClick={onSignIn}>
          <span aria-hidden="true">G</span>
          {busy ? 'Đang mở Google…' : ready ? 'Đăng nhập bằng Google' : 'Đang kiểm tra phiên đăng nhập…'}
        </button>
        <p className="auth-footnote">Website chỉ dùng tài khoản Google để xác định đúng chủ sở hữu cấu hình. Ảnh giao dịch vẫn được xử lý trực tiếp trên trình duyệt.</p>
      </section>
    </main>
  );
}

export default function UnifiedDashboard({ initialTab = 'doc-anh' }: { initialTab?: UnifiedTabId }) {
  const [activeTab, setActiveTab] = useState<UnifiedTabId>(initialTab);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState(
    isFirebaseConfigured ? '' : 'Firebase chưa được cấu hình cho website này.',
  );
  const tabRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    return onAuthStateChanged(
      auth,
      (nextUser) => {
        setUser(nextUser);
        setAuthReady(true);
      },
      (error) => {
        setAuthError(authErrorMessage(error));
        setAuthReady(true);
      },
    );
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setActiveTab(tabFromLocation(initialTab));
      window.scrollTo({ top: 0, behavior: 'auto' });
    };
    handlePopState();
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [initialTab]);

  const selectTab = (tabId: UnifiedTabId) => {
    setActiveTab(tabId);
    window.history.replaceState({ tab: tabId }, '', tabUrl(tabId));
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const handleTabClick = (event: MouseEvent<HTMLAnchorElement>, tabId: UnifiedTabId) => {
    event.preventDefault();
    selectTab(tabId);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    else return;

    event.preventDefault();
    const nextTab = TABS[nextIndex];
    selectTab(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  };

  const handleSignIn = async () => {
    setAuthBusy(true);
    setAuthError('');
    try {
      await signInWithGoogle();
    } catch (error) {
      setAuthError(authErrorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  };

  if (!authReady || !user) {
    return <LoginScreen ready={authReady} busy={authBusy} error={authError} onSignIn={() => void handleSignIn()} />;
  }

  return (
    <div className="unified-app">
      <header className="unified-header">
        <div className="unified-header-inner">
          <button className="unified-brand" type="button" onClick={() => selectTab('doc-anh')}>
            <span className="unified-brand-mark" aria-hidden="true">S</span>
            <span><strong>SIM Report</strong><small>Stavian Industrial Metal</small></span>
          </button>

          <nav className="unified-tablist" role="tablist" aria-label="Công cụ SIM Report">
            {TABS.map((tab, index) => {
              const selected = activeTab === tab.id;
              return (
                <a
                  key={tab.id}
                  ref={(element) => { tabRefs.current[index] = element; }}
                  id={`tab-${tab.id}`}
                  className={`unified-tab${selected ? ' active' : ''}`}
                  href={tabUrl(tab.id)}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={(event) => handleTabClick(event, tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  {tab.label}
                </a>
              );
            })}
          </nav>

          <div className="unified-account">
            <span className="unified-account-fallback" aria-hidden="true">{(user.displayName || user.email || 'U').slice(0, 1).toUpperCase()}</span>
            <span className="unified-account-copy"><strong>{user.displayName || 'Tài khoản Google'}</strong><small>{user.email || 'Đã đăng nhập'}</small></span>
            <button type="button" onClick={() => void signOutCurrentUser()}>Đăng xuất</button>
          </div>
        </div>
      </header>

      <section id="panel-doc-anh" className="unified-panel unified-panel-image" role="tabpanel" aria-labelledby="tab-doc-anh" hidden={activeTab !== 'doc-anh'}>
        <WorkspaceV2 userId={user.uid} />
      </section>
      <section id="panel-tong-hop-lenh" className="unified-panel unified-panel-monthly" role="tabpanel" aria-labelledby="tab-tong-hop-lenh" hidden={activeTab !== 'tong-hop-lenh'}>
        <MonthlyReportTool />
      </section>
      <section id="panel-bao-cao-tuan" className="unified-panel unified-panel-weekly" role="tabpanel" aria-labelledby="tab-bao-cao-tuan" hidden={activeTab !== 'bao-cao-tuan'}>
        <WeeklyReportTool />
      </section>
    </div>
  );
}
