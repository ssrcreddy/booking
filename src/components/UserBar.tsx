import { useAuth } from '../auth/AuthProvider';

export function UserBar() {
  const { user, signOut } = useAuth();
  if (!user) return null;

  return (
    <div className="user-bar">
      <span>
        Signed in as <strong>{user.name || user.email}</strong>
      </span>
      <button className="btn link" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}
