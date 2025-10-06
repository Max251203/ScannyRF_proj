import Header from './Header.jsx'
import Footer from './Footer.jsx'
import ToastHost from './Toast.jsx'
import { Outlet } from 'react-router-dom'

export default function Layout(){
  return (
    <div className="layout">
      <Header />
      <main className="page">
        <Outlet />
      </main>
      <Footer />
      <ToastHost />
    </div>
  )
}