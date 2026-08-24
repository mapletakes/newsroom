'use client';

// A prominent, always-visible logout — /setup keeps its own "Log out" button
// too (some mods only ever land there), but that one's easy to miss since
// it's buried below everything else on the settings page. This one lives in
// the shared header so it's reachable from every authenticated view.
export function LogOutButton() {
  const logout = async () => {
    await fetch('/api/auth', { method: 'POST' });
    window.location.href = '/';
  };

  return (
    <button onClick={logout} className="underline hover:text-rust">
      Log out
    </button>
  );
}
