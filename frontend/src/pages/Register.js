import { Navigate } from 'react-router-dom';

// Self-registration is disabled. Accounts are created by admin only.
export default function Register() {
  return <Navigate to="/login" replace />;
}
