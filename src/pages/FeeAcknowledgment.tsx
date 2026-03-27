import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { PAYMENT_METHODS, ENTRY_FEE } from '../constants/theme';

export default function FeeAcknowledgment() {
  const [loading, setLoading] = useState(false);
  const { updateUser } = useAuth();
  const navigate = useNavigate();

  const handleAcknowledge = async () => {
    setLoading(true);
    await updateUser({ feeAcknowledged: true });
    navigate('/leaderboard');
  };

  return (
    <div className="min-h-screen bg-masters-green flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-6">
          <span className="text-4xl">&#128176;</span>
          <h1 className="text-2xl font-bold text-masters-green mt-3">Entry Fee</h1>
          <p className="text-gray-500 mt-1">${ENTRY_FEE} per entry</p>
        </div>

        <div className="bg-masters-cream rounded-xl p-5 mb-6">
          <h2 className="font-semibold text-gray-800 mb-3">Payment Methods</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-600 font-medium">Venmo</span>
              <span className="font-mono text-masters-green font-semibold">{PAYMENT_METHODS.venmo}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600 font-medium">Cash App</span>
              <span className="font-mono text-masters-green font-semibold">{PAYMENT_METHODS.cashApp}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600 font-medium">PayPal</span>
              <span className="font-mono text-masters-green font-semibold">{PAYMENT_METHODS.payPal}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600 font-medium">Zelle</span>
              <span className="font-mono text-masters-green font-semibold">{PAYMENT_METHODS.zelle}</span>
            </div>
          </div>
        </div>

        <p className="text-sm text-gray-500 mb-6 text-center">
          You may submit unlimited entries. Each entry is ${ENTRY_FEE}. Payment is tracked by the pool administrator.
        </p>

        <button
          onClick={handleAcknowledge}
          disabled={loading}
          className="w-full bg-masters-green text-white py-3 rounded-lg font-semibold hover:bg-masters-dark transition disabled:opacity-50"
        >
          {loading ? 'Please wait...' : 'I Understand — Continue'}
        </button>
      </div>
    </div>
  );
}
