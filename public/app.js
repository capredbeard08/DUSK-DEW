/* DUSK & DEW — small, dependency-free client behaviour. */
(function () {
  'use strict';

  var BAG_KEY = 'dd_bag_v1';

  function readBag() {
    try {
      var raw = localStorage.getItem(BAG_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(function (i) { return i && i.id && i.qty > 0; }) : [];
    } catch (e) {
      return [];
    }
  }

  function writeBag(bag) {
    try {
      localStorage.setItem(BAG_KEY, JSON.stringify(bag));
    } catch (e) {
      /* storage unavailable — bag stays in memory for this page */
    }
    paintCount();
  }

  function money(cents) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
  }

  function paintCount() {
    var bag = readBag();
    var count = bag.reduce(function (sum, item) { return sum + item.qty; }, 0);
    document.querySelectorAll('#bag-count').forEach(function (el) { el.textContent = String(count); });
    document.querySelectorAll('[data-bag-label]').forEach(function (el) {
      el.textContent = count ? 'Bag (' + count + ')' : 'Bag';
    });
  }

  function addToBag(item, qty) {
    var bag = readBag();
    var existing = bag.find(function (i) { return i.id === item.id; });
    if (existing) existing.qty = Math.min(99, existing.qty + qty);
    else bag.push(Object.assign({}, item, { qty: Math.min(99, qty) }));
    writeBag(bag);
  }

  function lineArt(tone) {
    var tones = {
      amber: ['#B07A33', '#7C4E1B'],
      deep: ['#6E4A2C', '#43290F'],
      soft: ['#C79A62', '#94682F'],
      green: ['#3E5C4A', '#223A2C']
    };
    var t = tones[tone] || tones.amber;
    return '<svg viewBox="0 0 80 100" aria-hidden="true" class="bag-art"><rect x="30" y="4" width="20" height="9" rx="2" fill="#2A241C"/><path d="M32 13h16c4 0 7 3 7 7v72c0 2-2 4-4 4H29c-2 0-4-2-4-4V20c0-4 3-7 7-7z" fill="' + t[0] + '"/><rect x="28" y="34" width="24" height="30" rx="2" fill="#F6EFE3"/><text x="40" y="50" text-anchor="middle" font-family="Georgia,serif" font-size="5" fill="#1C3A2E">D&amp;D</text></svg>';
  }

  function renderBagPage() {
    var container = document.getElementById('bag-items');
    if (!container) return;
    var bag = readBag();
    if (!bag.length) {
      container.innerHTML = '<div class="empty"><p class="empty-title">Your bag is empty</p><p>Add a product from the collection to begin.</p><a class="btn btn-dark" href="/shop">Shop the collection</a></div>';
      var subtotalEl = document.getElementById('bag-subtotal');
      if (subtotalEl) subtotalEl.textContent = money(0);
      return;
    }
    var subtotal = 0;
    container.innerHTML = bag.map(function (item) {
      subtotal += item.price * item.qty;
      return '<div class="bag-item" data-id="' + item.id + '">' +
        '<div class="bag-item-art">' + lineArt(item.tone) + '</div>' +
        '<div class="bag-item-body"><a class="bag-item-name" href="/shop/' + encodeURIComponent(item.slug || '') + '">' + escapeHtml(item.name) + '</a>' +
        '<p class="fine">' + escapeHtml(item.net || '') + '</p>' +
        '<div class="qty-control" role="group" aria-label="Quantity for ' + escapeHtml(item.name) + '">' +
        '<button type="button" data-qty="-1" aria-label="Decrease quantity">−</button><span>' + item.qty + '</span><button type="button" data-qty="1" aria-label="Increase quantity">+</button></div>' +
        '</div><div class="bag-item-price">' + money(item.price * item.qty) + '<button class="linklike" type="button" data-remove>Remove</button></div></div>';
    }).join('');
    var subtotalEl = document.getElementById('bag-subtotal');
    if (subtotalEl) subtotalEl.textContent = money(subtotal);

    container.querySelectorAll('[data-qty]').forEach(function (button) {
      button.addEventListener('click', function () {
        var row = button.closest('.bag-item');
        var bagNow = readBag();
        var item = bagNow.find(function (i) { return i.id === row.dataset.id; });
        if (!item) return;
        item.qty += Number(button.dataset.qty);
        if (item.qty < 1) item.qty = 1;
        if (item.qty > 99) item.qty = 99;
        writeBag(bagNow);
        renderBagPage();
      });
    });
    container.querySelectorAll('[data-remove]').forEach(function (button) {
      button.addEventListener('click', function () {
        var row = button.closest('.bag-item');
        writeBag(readBag().filter(function (i) { return i.id !== row.dataset.id; }));
        renderBagPage();
      });
    });
  }

  function renderCheckout() {
    var form = document.getElementById('checkout-form');
    if (!form) return;
    var bag = readBag();
    var list = document.getElementById('checkout-items-list');
    var itemsInput = document.getElementById('checkout-items');
    var subtotalEl = document.getElementById('checkout-subtotal');
    var shippingEl = document.getElementById('checkout-shipping');
    var totalEl = document.getElementById('checkout-total');
    if (!bag.length) {
      if (list) list.innerHTML = '<p class="empty-inline">Your bag is empty. <a href="/shop">Return to the collection</a>.</p>';
      if (subtotalEl) subtotalEl.textContent = money(0);
      return;
    }
    if (itemsInput) itemsInput.value = JSON.stringify(bag.map(function (i) { return { id: i.id, qty: i.qty }; }));
    var subtotal = bag.reduce(function (sum, item) { return sum + item.price * item.qty; }, 0);
    if (list) {
      list.innerHTML = bag.map(function (item) {
        return '<div class="checkout-line"><span>' + escapeHtml(item.name) + ' × ' + item.qty + '</span><span>' + money(item.price * item.qty) + '</span></div>';
      }).join('');
    }
    var select = form.querySelector('[data-shipping-select]');
    var shipping = select && select.selectedOptions[0] ? Number(select.selectedOptions[0].dataset.shipping || 0) : 0;
    if (subtotalEl) subtotalEl.textContent = money(subtotal);
    if (shippingEl) shippingEl.textContent = money(shipping);
    if (totalEl) totalEl.textContent = money(subtotal + shipping);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    paintCount();

    document.querySelectorAll('[data-add-to-bag]').forEach(function (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var qtyInput = form.querySelector('input[name="qty"]');
        var qty = Math.max(1, Math.min(99, Number(qtyInput && qtyInput.value) || 1));
        addToBag({
          id: form.dataset.id,
          name: form.dataset.name,
          price: Number(form.dataset.price) || 0,
          slug: form.dataset.slug,
          tone: form.dataset.imageTone,
          net: form.dataset.net
        }, qty);
        var button = form.querySelector('button[type="submit"]');
        if (button) {
          var original = button.textContent;
          button.textContent = 'Added to bag';
          button.disabled = true;
          setTimeout(function () { button.textContent = original; button.disabled = false; }, 1400);
        }
      });
    });

    renderBagPage();
    renderCheckout();

    var checkoutForm = document.getElementById('checkout-form');
    if (checkoutForm) {
      var select = checkoutForm.querySelector('[data-shipping-select]');
      if (select) select.addEventListener('change', renderCheckout);
      checkoutForm.addEventListener('submit', function (event) {
        if (!readBag().length) {
          event.preventDefault();
          window.alert('Your bag is empty. Add a product before continuing.');
        }
      });
    }

    document.querySelectorAll('[data-confirm]').forEach(function (el) {
      el.addEventListener('click', function (event) {
        if (!window.confirm(el.dataset.confirm || 'Are you sure?')) event.preventDefault();
      });
    });

    // Restore focus for founder console search fields after filtering.
    if (location.search.includes('q=')) {
      var first = document.querySelector('.toolbar-form input[type="search"]');
      if (first) first.focus();
    }
  });
})();
