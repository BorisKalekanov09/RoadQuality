import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import PublicView from './pages/PublicView.tsx';
import WorkerDashboard from './pages/WorkerDashboard.tsx';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-100 flex flex-col">
        <nav className="bg-white shadow p-4 flex justify-between items-center">
          <Link to="/" className="text-xl font-bold text-gray-800">Road Quality Monitor</Link>
          <div className="space-x-4">
            <Link to="/" className="text-gray-600 hover:text-gray-900">Map</Link>
            <Link to="/worker" className="text-gray-600 hover:text-gray-900">Worker Access</Link>
          </div>
        </nav>
        <div className="flex-1">
          <Routes>
            <Route path="/" element={<PublicView />} />
            <Route path="/worker" element={<WorkerDashboard />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
