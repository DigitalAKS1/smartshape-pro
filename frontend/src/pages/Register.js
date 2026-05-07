import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { ArrowRight } from 'lucide-react';

export default function Register() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'sales_person'
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await register(formData.email, formData.password, formData.name, formData.role);
    setLoading(false);

    if (result.success) {
      navigate('/dashboard');
    } else {
      setError(result.error);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-8">
      <div className="w-full max-w-md space-y-8">
        <div>
          <h2 className="text-4xl font-bold text-white mb-2" data-testid="register-title">Create Account</h2>
          <p className="text-[var(--text-secondary)]">Join SmartShape Pro today</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6" data-testid="register-form">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-md" data-testid="register-error">
              {error}
            </div>
          )}

          <div>
            <Label htmlFor="name" className="text-[var(--text-secondary)] uppercase text-xs tracking-wide mb-2 block">Full Name</Label>
            <Input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="bg-[var(--bg-primary)] border-[var(--border-color)] text-white focus:ring-[#e94560] focus:border-[#e94560]"
              data-testid="register-name-input"
            />
          </div>

          <div>
            <Label htmlFor="email" className="text-[var(--text-secondary)] uppercase text-xs tracking-wide mb-2 block">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
              className="bg-[var(--bg-primary)] border-[var(--border-color)] text-white focus:ring-[#e94560] focus:border-[#e94560]"
              data-testid="register-email-input"
            />
          </div>

          <div>
            <Label htmlFor="password" className="text-[var(--text-secondary)] uppercase text-xs tracking-wide mb-2 block">Password</Label>
            <Input
              id="password"
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required
              className="bg-[var(--bg-primary)] border-[var(--border-color)] text-white focus:ring-[#e94560] focus:border-[#e94560]"
              data-testid="register-password-input"
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-[#e94560] hover:bg-[#f05c75] text-white font-medium"
            data-testid="register-submit-button"
          >
            {loading ? 'Creating account...' : (
              <>
                Create Account <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </form>

        <p className="text-center text-[var(--text-muted)]">
          Already have an account?{' '}
          <Link to="/login" className="text-[#e94560] hover:text-[#f05c75] font-medium" data-testid="login-link">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}