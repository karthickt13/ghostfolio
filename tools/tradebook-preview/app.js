/* eslint-disable */
/**
 * Weekly trade book preview.
 *
 * Uses the bundled `@ghostfolio/common/tradebook` parser (the same code the
 * API runs server side) to show what a weekly upload would do: which trades
 * are recognized, which rows fail, which trades were already imported and
 * what the resulting portfolio looks like.
 */
(function () {
  var STORAGE_KEY = 'ghostfolio.tradebook-preview';
  var parseTradebookCsv = window.GhostfolioTradebook.parseTradebookCsv;
  var getTradeSignature = window.GhostfolioTradebook.getTradeSignature;

  // Seeded last prices. In production these come from Yahoo Finance
  // (RELIANCE.NS, TCS.BO, ...) and are refreshed by the cron service.
  var SEEDED_PRICES = {
    'HDFCBANK.NS': 1712.4,
    'INFY.NS': 1587.25,
    'ITC.NS': 428.9,
    'RELIANCE.NS': 1466.3,
    'TCS.NS': 3942.15,
    'TITAN.NS': 3450.75
  };

  var SAMPLE_CSV = [
    'Trade Date,Trading Symbol,Exchange,Transaction Type,Traded Qty,Avg Price,Brokerage,STT,Stamp Duty,GST,Order ID',
    '21-09-2026,RELIANCE-EQ,NSE,BUY,10,1420.50,0.00,1.42,0.07,0.26,2609210000123',
    '22-09-2026,TCS,NSE,BUY,5,3890.10,0.00,1.95,0.19,0.35,2609220000456',
    '22-09-2026,INFY,NSE,BUY,20,1532.65,0.00,3.06,0.15,0.55,2609220000789',
    '23-09-2026,TITAN,NSE,BUY,6,3380.00,0.00,2.03,0.20,0.36,2609230000011',
    '24-09-2026,HDFCBANK,NSE,BUY,15,1685.25,0.00,2.53,0.13,0.46,2609240000022',
    '25-09-2026,ITC,NSE,BUY,100,412.35,0.00,4.12,0.21,0.74,2609250000033',
    '25-09-2026,RELIANCE,NSE,SELL,4,1455.80,0.00,0.58,0.06,0.11,2609250000044'
  ].join('\n');

  var state = loadState();

  var elements = {
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    holdingsCounter: document.getElementById('holdingsCounter'),
    holdingsEmpty: document.getElementById('holdingsEmpty'),
    holdingsTable: document.querySelector('#holdingsTable tbody'),
    kpiCharges: document.getElementById('kpiCharges'),
    kpiInvested: document.getElementById('kpiInvested'),
    kpiRealized: document.getElementById('kpiRealized'),
    kpiTotal: document.getElementById('kpiTotal'),
    kpiUnrealized: document.getElementById('kpiUnrealized'),
    kpiValue: document.getElementById('kpiValue'),
    parseTextButton: document.getElementById('parseTextButton'),
    report: document.getElementById('report'),
    resetButton: document.getElementById('resetButton'),
    sampleButton: document.getElementById('sampleButton'),
    textarea: document.getElementById('csvText'),
    tradesCounter: document.getElementById('tradesCounter'),
    tradesEmpty: document.getElementById('tradesEmpty'),
    tradesTable: document.querySelector('#tradesTable tbody'),
    uploadCounter: document.getElementById('uploadCounter')
  };

  elements.dropzone.addEventListener('click', function () {
    elements.fileInput.click();
  });

  elements.fileInput.addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];

    if (file) {
      readFile(file);
    }

    event.target.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (type) {
    elements.dropzone.addEventListener(type, function (event) {
      event.preventDefault();
      elements.dropzone.classList.add('is-active');
    });
  });

  ['dragleave', 'drop'].forEach(function (type) {
    elements.dropzone.addEventListener(type, function (event) {
      event.preventDefault();
      elements.dropzone.classList.remove('is-active');
    });
  });

  elements.dropzone.addEventListener('drop', function (event) {
    var file = event.dataTransfer.files && event.dataTransfer.files[0];

    if (file) {
      readFile(file);
    }
  });

  elements.sampleButton.addEventListener('click', function () {
    elements.textarea.value = SAMPLE_CSV;
    importCsv(SAMPLE_CSV, 'sample-week.csv');
  });

  elements.parseTextButton.addEventListener('click', function () {
    importCsv(elements.textarea.value, 'pasted.csv');
  });

  elements.resetButton.addEventListener('click', function () {
    state = { prices: {}, trades: [], uploads: [] };
    saveState();
    elements.textarea.value = '';
    elements.report.hidden = true;
    render();
  });

  function readFile(file) {
    var reader = new FileReader();

    reader.onload = function () {
      importCsv(String(reader.result), file.name);
    };

    reader.readAsText(file);
  }

  function importCsv(csvContent, fileName) {
    var result = parseTradebookCsv({ csvContent: csvContent });
    var messages = [];

    if (!result.isTradebook) {
      messages.push({
        text:
          (result.errors[0] && result.errors[0].message) ||
          'The file does not look like a trade book',
        type: 'is-error'
      });
    }

    result.errors.forEach(function (error) {
      messages.push({
        text: 'Row ' + error.rowNumber + ': ' + error.message,
        type: 'is-error'
      });
    });

    result.warnings.forEach(function (warning) {
      messages.push({ text: warning, type: 'is-warning' });
    });

    var existingSignatures = {};

    state.trades.forEach(function (trade) {
      existingSignatures[getTradeSignature(trade)] = true;
    });

    var newTrades = [];
    var duplicates = 0;

    result.trades.forEach(function (trade) {
      if (existingSignatures[getTradeSignature(trade)]) {
        duplicates++;
        return;
      }

      existingSignatures[getTradeSignature(trade)] = true;
      newTrades.push(trade);
    });

    state.trades = state.trades.concat(newTrades);
    state.uploads.push({
      chargesTotal: result.chargesTotal,
      duplicates: duplicates,
      errors: result.errors.length,
      fileName: fileName,
      imported: newTrades.length,
      timestamp: new Date().toISOString()
    });

    saveState();

    messages.unshift({
      text:
        fileName +
        ': ' +
        newTrades.length +
        (newTrades.length === 1 ? ' trade imported' : ' trades imported') +
        ', ' +
        duplicates +
        ' skipped (already imported)',
      type: newTrades.length > 0 ? 'is-success' : 'is-warning'
    });

    renderReport(messages);
    render();
  }

  function renderReport(messages) {
    elements.report.hidden = false;
    elements.report.innerHTML = '';

    messages.forEach(function (message) {
      var node = document.createElement('div');

      node.className = 'report-message ' + message.type;
      node.textContent = message.text;
      elements.report.appendChild(node);
    });
  }

  function render() {
    var portfolio = computePortfolio();

    elements.holdingsCounter.textContent =
      portfolio.holdings.length +
      (portfolio.holdings.length === 1 ? ' holding' : ' holdings');
    elements.tradesCounter.textContent =
      state.trades.length +
      (state.trades.length === 1 ? ' trade' : ' trades');
    elements.uploadCounter.textContent =
      state.uploads.length +
      (state.uploads.length === 1 ? ' upload' : ' uploads');

    elements.kpiInvested.textContent = formatCurrency(portfolio.invested);
    elements.kpiValue.textContent = formatCurrency(portfolio.marketValue);
    elements.kpiCharges.textContent = formatCurrency(portfolio.charges);
    setSigned(elements.kpiUnrealized, portfolio.unrealized);
    setSigned(elements.kpiRealized, portfolio.realized);
    setSigned(elements.kpiTotal, portfolio.realized + portfolio.unrealized);

    renderHoldings(portfolio);
    renderTrades();
  }

  function renderHoldings(portfolio) {
    elements.holdingsTable.innerHTML = '';
    elements.holdingsEmpty.hidden = portfolio.holdings.length > 0;

    portfolio.holdings.forEach(function (holding) {
      var row = document.createElement('tr');
      var price = getPrice(holding.symbol);
      var marketValue = holding.quantity * price;
      var unrealized = marketValue - holding.cost;
      var returnRate = holding.cost > 0 ? (unrealized / holding.cost) * 100 : 0;

      row.innerHTML =
        '<td><strong>' +
        escapeHtml(holding.symbol) +
        '</strong></td>' +
        '<td class="num">' +
        formatNumber(holding.quantity) +
        '</td>' +
        '<td class="num">' +
        formatCurrency(holding.averageUnitPrice) +
        '</td>' +
        '<td class="num"><input class="price-input" type="number" min="0" step="0.05" value="' +
        price +
        '" data-symbol="' +
        escapeHtml(holding.symbol) +
        '" /></td>' +
        '<td class="num">' +
        formatCurrency(marketValue) +
        '</td>' +
        '<td class="num ' +
        signedClass(unrealized) +
        '">' +
        formatSigned(unrealized) +
        '</td>' +
        '<td class="num ' +
        signedClass(unrealized) +
        '">' +
        formatPercent(returnRate) +
        '</td>';

      elements.holdingsTable.appendChild(row);
    });

    Array.prototype.forEach.call(
      elements.holdingsTable.querySelectorAll('.price-input'),
      function (input) {
        input.addEventListener('change', function (event) {
          state.prices[event.target.dataset.symbol] = Number(
            event.target.value
          );
          saveState();
          render();
        });
      }
    );
  }

  function renderTrades() {
    elements.tradesTable.innerHTML = '';
    elements.tradesEmpty.hidden = state.trades.length > 0;

    var sortedTrades = state.trades.slice().sort(function (a, b) {
      return new Date(b.date) - new Date(a.date);
    });

    sortedTrades.forEach(function (trade) {
      var row = document.createElement('tr');

      row.innerHTML =
        '<td>' +
        new Date(trade.date).toISOString().slice(0, 10) +
        '</td>' +
        '<td><strong>' +
        escapeHtml(trade.symbol) +
        '</strong></td>' +
        '<td><span class="pill pill-' +
        trade.type.toLowerCase() +
        '">' +
        trade.type +
        '</span></td>' +
        '<td class="num">' +
        formatNumber(trade.quantity) +
        '</td>' +
        '<td class="num">' +
        formatCurrency(trade.unitPrice) +
        '</td>' +
        '<td class="num">' +
        formatCurrency(trade.charges) +
        '</td>' +
        '<td>' +
        escapeHtml(trade.account || '') +
        '</td>';

      elements.tradesTable.appendChild(row);
    });
  }

  /**
   * Weighted average cost accounting: sells realize profit against the
   * average buy price, the remaining position keeps the remaining cost.
   */
  function computePortfolio() {
    var positions = {};
    var realized = 0;
    var charges = 0;

    state.trades
      .slice()
      .sort(function (a, b) {
        return new Date(a.date) - new Date(b.date);
      })
      .forEach(function (trade) {
        var position = (positions[trade.symbol] = positions[trade.symbol] || {
          cost: 0,
          quantity: 0
        });

        charges += trade.charges;

        if (trade.type === 'BUY') {
          position.cost += trade.quantity * trade.unitPrice + trade.charges;
          position.quantity += trade.quantity;
        } else {
          var averageUnitPrice =
            position.quantity > 0 ? position.cost / position.quantity : 0;
          var quantity = Math.min(trade.quantity, position.quantity);

          realized +=
            trade.quantity * trade.unitPrice -
            trade.charges -
            averageUnitPrice * quantity;

          position.cost -= averageUnitPrice * quantity;
          position.quantity -= trade.quantity;
        }
      });

    var holdings = Object.keys(positions)
      .filter(function (symbol) {
        return positions[symbol].quantity > 0.000001;
      })
      .map(function (symbol) {
        var position = positions[symbol];

        return {
          averageUnitPrice: position.cost / position.quantity,
          cost: position.cost,
          quantity: position.quantity,
          symbol: symbol
        };
      })
      .sort(function (a, b) {
        return b.cost - a.cost;
      });

    var invested = holdings.reduce(function (total, holding) {
      return total + holding.cost;
    }, 0);

    var marketValue = holdings.reduce(function (total, holding) {
      return total + holding.quantity * getPrice(holding.symbol);
    }, 0);

    return {
      charges: charges,
      holdings: holdings,
      invested: invested,
      marketValue: marketValue,
      realized: realized,
      unrealized: marketValue - invested
    };
  }

  function getPrice(symbol) {
    if (typeof state.prices[symbol] === 'number') {
      return state.prices[symbol];
    }

    if (typeof SEEDED_PRICES[symbol] === 'number') {
      return SEEDED_PRICES[symbol];
    }

    return 0;
  }

  function setSigned(element, value) {
    element.textContent = formatSigned(value);
    element.className = 'kpi-value ' + signedClass(value);
  }

  function signedClass(value) {
    if (value > 0) {
      return 'positive';
    }

    if (value < 0) {
      return 'negative';
    }

    return '';
  }

  function formatCurrency(value) {
    return '₹' + formatNumber(value);
  }

  function formatSigned(value) {
    var sign = value > 0 ? '+' : value < 0 ? '−' : '';

    return sign + formatCurrency(Math.abs(value));
  }

  function formatPercent(value) {
    var sign = value > 0 ? '+' : value < 0 ? '−' : '';

    return sign + Math.abs(value).toFixed(2) + '%';
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('en-IN', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, function (character) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[character];
    });
  }

  function loadState() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY);

      if (stored) {
        var parsed = JSON.parse(stored);

        return {
          prices: parsed.prices || {},
          trades: parsed.trades || [],
          uploads: parsed.uploads || []
        };
      }
    } catch (error) {
      // Ignore a broken state and start over
    }

    return { prices: {}, trades: [], uploads: [] };
  }

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      // Storage is optional for the preview
    }
  }

  render();
})();
