import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { CurrentUserResponse, WorkspaceSummary } from '@impactlens/shared';
const base = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '');
export class ApiFailure extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let csrfToken: string | undefined;
export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const mutation = options.method && !['GET', 'HEAD'].includes(options.method);
  if (mutation && !csrfToken) {
    const response = await fetch(base + '/auth/csrf', {
      credentials: 'include',
    });
    if (!response.ok)
      throw new ApiFailure(
        response.status,
        'Unable to initialize a secure session. Try again.',
      );
    csrfToken = (await response.json()).csrfToken;
  }
  const response = await fetch(base + path, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(mutation ? { 'X-CSRF-Token': csrfToken! } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403)
      csrfToken = undefined;
    const message = body?.error?.message;
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('impactlens:session-expired'));
    throw new ApiFailure(
      response.status,
      Array.isArray(message)
        ? message.join('. ')
        : (message ?? 'Request failed. Try again.'),
    );
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (data.csrfToken) csrfToken = data.csrfToken;
  return data as T;
}
type AuthState = {
  current: CurrentUserResponse | null;
  workspace: WorkspaceSummary | undefined;
  selectWorkspace: (id: string) => void;
  refresh: () => Promise<void>;
  authenticate: (
    mode: 'login' | 'register',
    input: { email: string; password: string; name?: string },
  ) => Promise<void>;
  logout: () => Promise<void>;
};
const AuthContext = createContext<AuthState | null>(null);
export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is required');
  return value;
};
export function AuthProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<CurrentUserResponse | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  async function refresh() {
    try {
      const result = await apiRequest<CurrentUserResponse>('/auth/me');
      setCurrent(result);
      setFailure('');
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) {
        setCurrent(null);
        setFailure('');
      } else {
        setFailure(
          'Unable to reach your session. Check the API connection and retry.',
        );
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const expired = () => {
      csrfToken = undefined;
      setCurrent(null);
    };
    const focus = () => {
      void refresh();
    };
    window.addEventListener('impactlens:session-expired', expired);
    window.addEventListener('focus', focus);
    return () => {
      window.removeEventListener('impactlens:session-expired', expired);
      window.removeEventListener('focus', focus);
    };
  }, []);
  const workspace =
    current?.workspaces.find((w) => w.id === selectedId) ??
    current?.workspaces[0];
  if (loading)
    return (
      <div className="auth-layout" role="status">
        Checking your session…
      </div>
    );
  if (failure)
    return (
      <div className="auth-layout">
        <div className="panel" role="alert">
          <p>{failure}</p>
          <button onClick={() => void refresh()}>Retry session</button>
        </div>
      </div>
    );
  return (
    <AuthContext.Provider
      value={{
        current,
        workspace,
        selectWorkspace: setSelectedId,
        refresh,
        authenticate: async (mode, input) => {
          const result = await apiRequest<CurrentUserResponse>(
            '/auth/' + mode,
            { method: 'POST', body: JSON.stringify(input) },
          );
          setCurrent(result);
          setSelectedId('');
        },
        logout: async () => {
          await apiRequest('/auth/logout', { method: 'POST' });
          csrfToken = undefined;
          setCurrent(null);
          setSelectedId('');
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
