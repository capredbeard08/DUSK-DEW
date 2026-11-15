/** Customer account pages: registration, sign-in, order history, profile. */
import { publicLayout, field, csrfInput, h, money, fmtDate, pill, emptyState, table } from './ui.js';

export function loginPage(base, { mode = 'login', error = '' } = {}) {
  const isRegister = mode === 'register';
  return publicLayout({
    ...base,
    title: isRegister ? 'Create an account' : 'Sign in',
    body: `<section class="wrap auth-page">
      <div class="auth-copy">
        <p class="eyebrow">${isRegister ? 'Your account' : 'Welcome back'}</p>
        <h1>${isRegister ? 'Create an account' : 'Sign in'}</h1>
        <p class="lede">${isRegister ? 'Order history, saved addresses and waitlist notifications in one place. Accounts are optional — you can check out as a guest.' : 'Track orders, manage addresses and see your waitlist registrations.'}</p>
        <p class="fine">Accounts are protected with server-side sessions. We never store card details.</p>
      </div>
      <form class="panel-form" method="post" action="${isRegister ? '/account/register' : '/account/login'}">
        ${error ? `<div class="flash flash-error" role="alert">${h(error)}</div>` : ''}
        ${csrfInput(base.csrf)}
        ${isRegister ? field({ label: 'Name', name: 'name', required: true, attrs: 'autocomplete="name"' }) : ''}
        ${field({ label: 'Email', name: 'email', type: 'email', required: true, attrs: 'autocomplete="email"' })}
        ${field({ label: 'Password', name: 'password', type: 'password', required: true, attrs: `autocomplete="${isRegister ? 'new-password' : 'current-password'}"`, hint: isRegister ? 'At least 10 characters.' : '' })}
        <button class="btn btn-dark full" type="submit">${isRegister ? 'Create account' : 'Sign in'}</button>
        <p class="fine">${isRegister ? 'Already have an account? <a href="/account/login">Sign in</a>' : 'New here? <a href="/account/register">Create an account</a>'}</p>
        <p class="fine"><a href="/admin/login">Founder console →</a></p>
      </form>
    </section>`,
  });
}

export function accountPage(base) {
  const { customer, orders, addresses, waitlist } = base;
  return publicLayout({
    ...base,
    title: 'Your account',
    body: `<div class="wrap page-head"><p class="eyebrow">Account</p><h1>${h(customer.name)}</h1><p class="lede">${h(customer.email)}</p></div>
    <div class="wrap account-layout">
      <section>
        <div class="section-head"><h2>Orders</h2><a class="text-link" href="/shop">Continue shopping →</a></div>
        ${
          orders.length
            ? table(
                ['Reference', 'Placed', 'Total', 'Payment', 'Fulfilment', ''],
                orders.map((o) => [
                  `<a href="/order/${h(o.reference)}?email=${encodeURIComponent(customer.email)}">${h(o.reference)}</a>`,
                  h(fmtDate(o.placed_at)),
                  money(o.total_cents, o.currency),
                  pill(o.payment_status),
                  pill(o.fulfilment_status),
                  '<a class="text-link" href="/order/' + h(o.reference) + '?email=' + encodeURIComponent(customer.email) + '">View</a>',
                ]),
              )
            : emptyState('No orders yet', 'When you order, it will appear here.')
        }
      </section>
      <aside class="account-side">
        <h2>Your details</h2>
        <form method="post" action="/account/profile" class="stack-form">
          ${csrfInput(base.csrf)}
          ${field({ label: 'Name', name: 'name', value: customer.name, required: true })}
          ${field({ label: 'Country', name: 'country', value: customer.country || '', placeholder: 'NG' })}
          <label class="check"><input type="checkbox" name="marketing" ${customer.accepts_marketing ? 'checked' : ''}> <span>Send me occasional studio letters</span></label>
          <button class="btn btn-dark" type="submit">Save details</button>
        </form>
        <h2>Addresses</h2>
        ${
          addresses.length
            ? addresses
                .map(
                  (a) => `<address class="saved-address">${h(a.line1)}<br>${a.line2 ? `${h(a.line2)}<br>` : ''}${h(a.city)} ${h(a.region || '')} ${h(a.postcode)}<br>${h(a.country)}</address>`,
                )
                .join('')
            : '<p class="fine">No saved addresses yet.</p>'
        }
        <form method="post" action="/account/address" class="stack-form">
          ${csrfInput(base.csrf)}
          <h3>Add an address</h3>
          ${field({ label: 'Address line 1', name: 'line1', required: true })}
          ${field({ label: 'Address line 2', name: 'line2' })}
          ${field({ label: 'City', name: 'city', required: true })}
          ${field({ label: 'State / region', name: 'region' })}
          ${field({ label: 'Postcode', name: 'postcode', required: true })}
          ${field({ label: 'Country', name: 'country', value: customer.country || 'NG', required: true })}
          ${field({ label: 'Phone', name: 'phone', type: 'tel' })}
          <button class="btn btn-outline" type="submit">Save address</button>
        </form>
        <h2>Waitlist</h2>
        ${
          waitlist.length
            ? `<ul class="plain-list">${waitlist.map((w) => `<li>${h(w.product_name || 'General interest')} · ${h(w.status)}</li>`).join('')}</ul>`
            : '<p class="fine">No waitlist registrations.</p>'
        }
        <form method="post" action="/account/logout">${csrfInput(base.csrf)}<button class="btn btn-quiet full" type="submit">Sign out</button></form>
      </aside>
    </div>`,
  });
}

export function passwordPage(base, { error = '', notice = '' } = {}) {
  return publicLayout({
    ...base,
    title: 'Change password',
    body: `<section class="wrap auth-page">
      <div class="auth-copy"><p class="eyebrow">Security</p><h1>Change your password</h1><p class="lede">You are signed in${base.auth.mustChangePassword ? ' with a temporary password. Please set a new one.' : '.'}</p></div>
      <form class="panel-form" method="post" action="/account/password">
        ${csrfInput(base.csrf)}
        ${error ? `<div class="flash flash-error">${h(error)}</div>` : ''}
        ${notice ? `<div class="flash flash-ok">${h(notice)}</div>` : ''}
        ${field({ label: 'Current password', name: 'current', type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
        ${field({ label: 'New password', name: 'password', type: 'password', required: true, attrs: 'autocomplete="new-password"', hint: 'At least 10 characters.' })}
        ${field({ label: 'Confirm new password', name: 'confirm', type: 'password', required: true, attrs: 'autocomplete="new-password"' })}
        <button class="btn btn-dark full" type="submit">Update password</button>
      </form>
    </section>`,
  });
}
