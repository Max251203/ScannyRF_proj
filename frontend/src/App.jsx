import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Home from './pages/Home.jsx'
import Terms from './pages/Terms.jsx'
import Privacy from './pages/Privacy.jsx'
import Editor from './pages/Editor.jsx'
import Calculators from './pages/Calculators.jsx'
import Help from './pages/Help.jsx'
import Profile from './pages/Profile.jsx'
import OAuthCatch from './pages/OAuthCatch.jsx'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/editor" element={<Editor />} />
        <Route path="/calculators" element={<Calculators />} />
        <Route path="/help" element={<Help />} />
        <Route path="/help/:id" element={<Help />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/oauth" element={<OAuthCatch />} />
      </Route>
    </Routes>
  )
}