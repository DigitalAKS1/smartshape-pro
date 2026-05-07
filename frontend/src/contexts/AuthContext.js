import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { auth, formatApiErrorDetail } from '../lib/api';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    // CRITICAL: Skip auth check if returning from Google OAuth callback
    if (window.location.hash?.includes('session_id=')) {
      setLoading(false);
      return;
    }

    try {
      const { data } = await auth.me();
      setUser(data);
    } catch (error) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email, password) => {
    try {
      const { data } = await auth.login({ email, password });
      setUser(data);
      return { success: true };
    } catch (error) {
      return { success: false, error: formatApiErrorDetail(error.response?.data?.detail) || error.message };
    }
  };

  const register = async (email, password, name, role) => {
    try {
      const { data } = await auth.register({ email, password, name, role });
      setUser(data);
      return { success: true };
    } catch (error) {
      return { success: false, error: formatApiErrorDetail(error.response?.data?.detail) || error.message };
    }
  };

  const logout = async () => {
    try {
      await auth.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
    }
  };

  const processGoogleSession = async (sessionId) => {
    try {
      const { data } = await auth.googleSession(sessionId);
      setUser(data);
      return { success: true, user: data };
    } catch (error) {
      return { success: false, error: formatApiErrorDetail(error.response?.data?.detail) || error.message };
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, processGoogleSession, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};