import { PAYMENT_METHODS, ENTRY_FEE } from '../constants/theme';

export default function Settings() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Pool Info</h1>

      {/* Payment Information */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Payment Information</h2>
        <p className="text-sm text-gray-600 mb-4">
          ${ENTRY_FEE} per entry. Payments due by midnight, Wednesday, April 8th.
        </p>
        <div className="bg-masters-cream rounded-xl p-5">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-600 font-medium">Venmo <span className="text-xs text-masters-green">(preferred)</span></span>
              <span className="font-mono text-masters-green font-semibold">
                {PAYMENT_METHODS.venmo}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600 font-medium">Cash App</span>
              <span className="font-mono text-masters-green font-semibold">
                {PAYMENT_METHODS.cashApp}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600 font-medium">PayPal</span>
              <span className="font-mono text-masters-green font-semibold">
                {PAYMENT_METHODS.payPal}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600 font-medium">Zelle</span>
              <span className="font-mono text-masters-green font-semibold">
                {PAYMENT_METHODS.zelle}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Contact */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Questions?</h2>
        <p className="text-sm text-gray-500 mb-4">Reach out to Phil directly.</p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-600 font-medium">Phone</span>
            <a
              href="tel:+17179032280"
              className="font-mono text-masters-green font-semibold hover:underline"
            >
              (717) 903-2280
            </a>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600 font-medium">Email</span>
            <a
              href="mailto:itsphil24@gmail.com"
              className="font-mono text-masters-green font-semibold hover:underline"
            >
              itsphil24@gmail.com
            </a>
          </div>
        </div>
      </div>

      {/* Pool Instructions */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Pool Instructions</h2>
        <ul className="space-y-3 text-sm text-gray-700">
          <li className="flex gap-2">
            <span className="text-masters-green font-bold shrink-0">&bull;</span>
            <span>$10 entry fee per card submitted. Multiple entries are allowed.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-masters-green font-bold shrink-0">&bull;</span>
            <span>You will pick 1 player from each tier.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-masters-green font-bold shrink-0">&bull;</span>
            <span>
              Scoring is counted by the position the golfer finishes in. For example: 1st
              place = 1 point, 2nd place = 2 points, and so on.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-masters-green font-bold shrink-0">&bull;</span>
            <span>
              If your player misses the cut, the score will be the number of players who
              made the cut, plus 1.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-masters-green font-bold shrink-0">&bull;</span>
            <span>The object is to have the lowest total score, just like golf.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-masters-green font-bold shrink-0">&bull;</span>
            <span>
              Payments can be made via Venmo (preferred), PayPal, Cash App, or Zelle up until midnight,
              Wednesday, April 8th.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-masters-green font-bold shrink-0">&bull;</span>
            <span>After each round, everyone will have updated scores.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-masters-green font-bold shrink-0">&bull;</span>
            <span>
              Payouts will be the leader at the end of each day and last year we paid the
              Top 8 places (subject to change depending on total number of entries).
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
