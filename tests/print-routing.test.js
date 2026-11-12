const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const onlineMenuHtml = fs.readFileSync(path.join(__dirname, '..', 'cardapio online.html'), 'utf8');

function extractFunction(startMarker, endMarker, exportName, context) {
    const start = html.indexOf(startMarker);
    const end = html.indexOf(endMarker, start);
    assert.notEqual(start, -1, `Could not find ${exportName}`);
    assert.notEqual(end, -1, `Could not find the end of ${exportName}`);
    vm.runInNewContext(
        `${html.slice(start, end)}\nthis.${exportName} = ${exportName};`,
        context
    );
    return context[exportName];
}

function extractOnlineMenuFunction(startMarker, endMarker, exportName, context) {
    const start = onlineMenuHtml.indexOf(startMarker);
    const end = onlineMenuHtml.indexOf(endMarker, start);
    assert.notEqual(start, -1, `Could not find ${exportName}`);
    assert.notEqual(end, -1, `Could not find the end of ${exportName}`);
    vm.runInNewContext(
        `${onlineMenuHtml.slice(start, end)}\nthis.${exportName} = ${exportName};`,
        context
    );
    return context[exportName];
}

test('category routing lets operators explicitly exclude a category', () => {
    let saves = 0;
    const context = {
        qzSettings: { categorySectors: {}, sectors: [{ id: 'kitchen' }] },
        saveQzSettings() { saves++; },
        toast(message) { throw new Error(message); }
    };
    const updateCategorySector = extractFunction(
        '        function updateCategorySector(',
        '        function updateCopySetting(',
        'updateCategorySector',
        context
    );

    updateCategorySector('Bebidas', 'none');

    assert.equal(context.qzSettings.categorySectors.Bebidas, 'none');
    assert.equal(saves, 1);
    assert.match(html, /<option value="none".*?>Não imprimir<\/option>/);
});

test('production batches omit excluded categories and keep other routing', () => {
    const context = {
        qzSettings: {
            categorySectors: { Bebidas: 'none', Petiscos: 'preparation' },
            sectors: [{ id: 'kitchen' }, { id: 'preparation' }]
        }
    };
    const productionPrintBatches = extractFunction(
        '        function productionPrintBatches(',
        '        async function savePrintAgentToken(',
        'productionPrintBatches',
        context
    );

    const batches = productionPrintBatches({
        items: [
            { name: 'Refrigerante', category: 'Bebidas' },
            { name: 'Batata frita', category: 'Petiscos' },
            { name: 'Pizza', category: 'Pizzas' }
        ]
    });

    assert.deepEqual(
        JSON.parse(JSON.stringify(
            batches.map(batch => [batch.printSectorId, batch.items.map(item => item.name)])
        )),
        [['preparation', ['Batata frita']], ['kitchen', ['Pizza']]]
    );
});

test('automatic printing schedules an order only once per browser session', async () => {
    let printCount = 0;
    const context = {
        automaticPrintQueue: new Set(),
        qzSettings: { enabled: true, automatic: true },
        isPrintAgentConnected: () => true,
        printBothThermal: () => {
            printCount++;
            return Promise.resolve();
        },
        console,
        toast() {}
    };
    const scheduleAutomaticOrderPrint = extractFunction(
        '        function scheduleAutomaticOrderPrint(',
        '        function initSharedStateSync(',
        'scheduleAutomaticOrderPrint',
        context
    );
    const order = { id: 72501, printRequested: true };

    scheduleAutomaticOrderPrint(order);
    scheduleAutomaticOrderPrint(order);
    await Promise.resolve();

    assert.equal(printCount, 1);
});

test('accepted online orders print on the remote agent even when normal auto-print is off', async () => {
    let printCount = 0;
    const context = {
        automaticPrintQueue: new Set(),
        qzSettings: { enabled: true, automatic: false },
        isPrintAgentConnected: () => true,
        printBothThermal: () => {
            printCount++;
            return Promise.resolve();
        },
        console,
        toast() {}
    };
    const scheduleAutomaticOrderPrint = extractFunction(
        '        function scheduleAutomaticOrderPrint(',
        '        function initSharedStateSync(',
        'scheduleAutomaticOrderPrint',
        context
    );

    scheduleAutomaticOrderPrint({ id: 72502, printRequested: true, onlineOrderPrint: true });
    await Promise.resolve();

    assert.equal(printCount, 1);
});

test('pizza menu shows medium, large and family sizes before flavor selection', () => {
    const elements = {
        'menu-search': { value: '' },
        'menu-cats': { innerHTML: '' },
        'menu-grid': { innerHTML: '' }
    };
    const context = {
        $: id => elements[id],
        curCat: 'Pizzas',
        S: { menu: { cats: {}, pt: [10, 20, 30, 40], pd: [10, 20, 30, 40] } },
        SIZES: ['Pequena', 'Média', 'Grande', 'Família'],
        menuItems: () => [],
        promotionPrice: (_key, price) => price,
        money: price => `R$ ${price}`,
        esc: value => value
    };
    extractFunction('        function renderMenu(', '        function pick(', 'renderMenu', context)();

    assert.match(elements['menu-grid'].innerHTML, /Pizza Média/);
    assert.match(elements['menu-grid'].innerHTML, /Pizza Grande/);
    assert.match(elements['menu-grid'].innerHTML, /Pizza Família/);
    assert.doesNotMatch(elements['menu-grid'].innerHTML, /Pizza Calabresa|Pizza Mussarela/);
    assert.match(elements['menu-grid'].innerHTML, /openPizza\('',0,1\)/);
    assert.match(elements['menu-grid'].innerHTML, /openPizza\('',0,2\)/);
    assert.match(elements['menu-grid'].innerHTML, /openPizza\('',0,3\)/);
});

test('selecting a pizza size opens the flavor step with that size selected', () => {
    const context = {
        pm: null,
        S: { menu: { mf: [4, 4, 4, 4] } },
        renderPM() {},
        $: () => ({ classList: { remove() {}, add() {} } })
    };
    const openPizza = extractFunction(
        '        function openPizza(',
        '        function closePizza(',
        'openPizza',
        context
    );

    openPizza('', 0, 3);

    assert.equal(context.pm.s, 3);
    assert.equal(context.pm.sizeSelected, true);
    assert.deepEqual(JSON.parse(JSON.stringify(context.pm.fl)), []);
});

test('online checkout payload matches the order bridge contract', () => {
    const buildOnlineOrderPayload = extractOnlineMenuFunction(
        '        function roundOnlineMoney(',
        '        function createOnlineOrderIdentity(',
        'buildOnlineOrderPayload',
        {}
    );
    const payload = buildOnlineOrderPayload({
        customerName: 'Cliente',
        customerPhone: '(77) 99111-2222',
        deliveryType: 'delivery',
        address: 'Rua 1, 10',
        complement: 'Casa azul',
        deliveryFee: 5,
        payment: 'Pix'
    }, [
        { name: 'Pizza Família', size: 'Família', qty: 1, price: 65, flavors: ['Calabresa', 'Atum'] },
        { name: 'Refrigerante Lata', size: 'Padrão', qty: 2, price: 6 }
    ]);

    assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
        customer: { name: 'Cliente', phone: '(77) 99111-2222' },
        items: [
            { name: 'Pizza Família', size: 'Família', qty: 1, price: 65, flavors: ['Calabresa', 'Atum'] },
            { name: 'Refrigerante Lata', size: 'Padrão', qty: 2, price: 6, flavors: [] }
        ],
        deliveryType: 'delivery',
        address: 'Rua 1, 10',
        complement: 'Casa azul',
        subtotal: 77,
        deliveryFee: 5,
        total: 82,
        payment: 'Pix'
    });
});

test('online checkout submits directly to the order bridge and tracks status', () => {
    assert.match(onlineMenuHtml, /action:\s*'submit_order'/);
    assert.match(onlineMenuHtml, /action:\s*'order_status'/);
    const checkoutStart = onlineMenuHtml.indexOf('        async function finishOnlineOrder(');
    const checkoutEnd = onlineMenuHtml.indexOf('        // CHECK DAY OF WEEK', checkoutStart);
    assert.notEqual(checkoutStart, -1);
    assert.notEqual(checkoutEnd, -1);
    assert.doesNotMatch(onlineMenuHtml.slice(checkoutStart, checkoutEnd), /wa\.me/);
});

test('online order retries reuse the same idempotency credentials', async () => {
    const calls = [];
    const context = {
        ORDER_BRIDGE_URL: 'https://example.test/order-bridge',
        ORDER_BRIDGE_API_KEY: 'public-key',
        pendingOnlineSubmission: {
            requestId: 'b17e59e1-9c58-4e16-8a4b-64652a522480',
            trackingToken: 'a'.repeat(64),
            payload: { customer: { name: 'Cliente' } }
        },
        fetch: async (url, options) => {
            calls.push({ url, options, body: JSON.parse(options.body) });
            return { ok: true, json: async () => ({ order: { id: 'order-1' } }) };
        }
    };
    const sendOnlineOrderRequest = extractOnlineMenuFunction(
        '        async function sendOnlineOrderRequest(',
        '        function saveOnlineOrderTracking(',
        'sendOnlineOrderRequest',
        context
    );

    await sendOnlineOrderRequest();
    await sendOnlineOrderRequest();

    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.requestId, calls[1].body.requestId);
    assert.equal(calls[0].body.trackingToken, calls[1].body.trackingToken);
    assert.equal(calls[0].body.action, 'submit_order');
});

test('accepted online orders delegate printing only when the agent is remote', () => {
    const context = {
        isPrintAgentConnected: () => false,
        isSharedPrintAgentOnline: () => true
    };
    const shouldDelegateAcceptedOnlinePrint = extractFunction(
        '        function shouldDelegateAcceptedOnlinePrint(',
        '        async function callOrderBridge(',
        'shouldDelegateAcceptedOnlinePrint',
        context
    );

    assert.equal(shouldDelegateAcceptedOnlinePrint(), true);
    context.isPrintAgentConnected = () => true;
    assert.equal(shouldDelegateAcceptedOnlinePrint(), false);
});

test('inline scripts in the POS and online menu parse successfully', () => {
    for (const [file, source] of [['index.html', html], ['cardapio online.html', onlineMenuHtml]]) {
        const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
        assert.ok(scripts.length, `${file} should contain inline scripts`);
        scripts.forEach((script, index) => {
            if (script[1].trim()) {
                assert.doesNotThrow(
                    () => new vm.Script(script[1], { filename: `${file}#${index + 1}` }),
                    `${file} inline script ${index + 1} should parse`
                );
            }
        });
    }
});

test('online menu shows the updated restaurant name and address consistently', () => {
    assert.match(onlineMenuHtml, /<title>Restaurante e Pizzaria Gabryelle/);
    assert.match(onlineMenuHtml, /R\. Treze de Maio, 307/);
    assert.match(onlineMenuHtml, /Itapetinga - BA, 45700-000/);
    assert.match(onlineMenuHtml, /q=R\.\+Treze\+de\+Maio,\+307,\+Itapetinga,\+BA,\+45700-000/);
    assert.doesNotMatch(onlineMenuHtml, /Avenida Cinquentenário|Dricka Sorvete/);
});
