import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import AdminPage from '@/pages/AdminPage';
import GamePage from '@/pages/GamePage';
import HistoryPage from '@/pages/HistoryPage';
import SettingsPage from '@/pages/SettingsPage';

function AppShell() {
  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<GamePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
      <nav className="bottom-nav bottom-nav-four">
        <NavLink to="/">Game</NavLink>
        <NavLink to="/history">History</NavLink>
        <NavLink to="/settings">Settings</NavLink>
        <NavLink to="/admin">Admin</NavLink>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}