/* Input: multi-touch buttons + keyboard, exposed as a simple held-state map. */
(function () {
  'use strict';

  var state = {
    gas: false,
    brake: false,
    leanBack: false,
    leanFwd: false,
    eject: false,
    restart: false
  };

  // pointerId -> control name, so multi-touch (gas + lean at once) works
  var pointerCtl = {};

  function setCtl(name, held, el) {
    if (name in state) state[name] = held;
    if (el) el.classList.toggle('held', held);
  }

  function bindButtons() {
    var buttons = document.querySelectorAll('.ctl');
    buttons.forEach(function (el) {
      var name = el.dataset.ctl;

      el.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        pointerCtl[e.pointerId] = { name: name, el: el };
        setCtl(name, true, el);
      });

      // Sliding a finger onto a button also activates it
      el.addEventListener('pointerenter', function (e) {
        if (e.pointerType === 'touch' && e.buttons) {
          pointerCtl[e.pointerId] = { name: name, el: el };
          setCtl(name, true, el);
        }
      });

      el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    });

    function release(e) {
      var c = pointerCtl[e.pointerId];
      if (c) {
        setCtl(c.name, false, c.el);
        delete pointerCtl[e.pointerId];
      }
    }
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }

  var KEYMAP = {
    ArrowUp: 'gas', KeyW: 'gas',
    ArrowDown: 'brake', KeyS: 'brake',
    ArrowLeft: 'leanBack', KeyA: 'leanBack',
    ArrowRight: 'leanFwd', KeyD: 'leanFwd',
    KeyZ: 'eject',
    KeyR: 'restart'
  };

  function bindKeyboard() {
    window.addEventListener('keydown', function (e) {
      var name = KEYMAP[e.code];
      if (name) {
        state[name] = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', function (e) {
      var name = KEYMAP[e.code];
      if (name) {
        state[name] = false;
        e.preventDefault();
      }
    });
  }

  function init() {
    bindButtons();
    bindKeyboard();
  }

  window.Input = { state: state, init: init };
})();
