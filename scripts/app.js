        // ✅ إصلاح #34: تغليف المتغيرات في IIFE لمنع التلوث العام
        (function(window, document) {
            'use strict';
            
        // ═══════════════ المتغيرات العامة ═══════════════
        var busData = [];
        // ✅ إصلاح #37: تم إزالة busRecords (كان Dead Code)
        var departedBuses = [];
        // ✅ إصلاح #38: تم إزالة gateStats (كان Dead Code)
        var dailyStats = { buses: 0, pax: 0, early: 0, ontime: 0, late: 0, flights: new Set() };
        var zoomLevel = 100;
        var editMode = false;
        var panelVisible = true;
        var thresholds = { early: 7, late: 3 };
        var currentSpotForForm = null;
        var currentBusForForm = null;
        var currentFormName = null;
        
        // ✅ إصلاح #56: متغيرات لتتبع intervals ومنع تسريب الذاكرة
        var intervalIds = {
            updateTime: null,
            updateCountdowns: null,
            saveData: null
        };

        // ═══════════════ البوابات ═══════════════
        var gates = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];

        // ✅ إصلاح #2: دالة آمنة لتحليل JSON مع معالجة الأخطاء
        function safeJSONParse(jsonString, defaultValue) {
            if (defaultValue === undefined) { defaultValue = null; }
            if (!jsonString || typeof jsonString !== 'string') {
                return defaultValue;
            }
            try {
                return JSON.parse(jsonString);
            } catch (error) {
                console.error('خطأ في تحليل JSON:', error.message);
                return defaultValue;
            }
        }

        // ✅ إصلاح #3: دالة آمنة لتحويل إلى JSON
        function safeJSONStringify(data, defaultValue) {
            if (defaultValue === undefined) { defaultValue = '{}'; }
            try {
                return JSON.stringify(data);
            } catch (error) {
                console.error('خطأ في تحويل إلى JSON:', error.message);
                return defaultValue;
            }
        }

        // ✅ إصلاح #55: دوال تشفير وفك تشفير بسيطة للبيانات المحلية
        // تحذير: هذا تشفير بسيط (obfuscation) وليس تشفير قوي
        // للبيانات الحساسة جداً استخدم Web Crypto API
        var STORAGE_KEY = 'LOCC_2024';
        
        function simpleEncrypt(text) {
            if (!text) return '';
            var result = '';
            for (var i = 0; i < text.length; i++) {
                var charCode = text.charCodeAt(i) ^ STORAGE_KEY.charCodeAt(i % STORAGE_KEY.length);
                result += String.fromCharCode(charCode);
            }
            // تحويل لـ Base64 للتخزين الآمن
            try {
                return btoa(encodeURIComponent(result));
            } catch (e) {
                return btoa(result);
            }
        }
        
        function simpleDecrypt(encoded) {
            if (!encoded) return '';
            
            // ✅ فحص إذا كانت البيانات JSON عادي (غير مشفر) - للتوافق مع البيانات القديمة
            if (encoded.charAt(0) === '{' || encoded.charAt(0) === '[') {
                return encoded; // بيانات قديمة غير مشفرة
            }
            
            // ✅ فحص إذا كانت Base64 صالحة
            var base64Regex = /^[A-Za-z0-9+/=]+$/;
            if (!base64Regex.test(encoded)) {
                return encoded; // ليست Base64، أرجعها كما هي
            }
            
            try {
                var text;
                try {
                    text = decodeURIComponent(atob(encoded));
                } catch (e) {
                    text = atob(encoded);
                }
                var result = '';
                for (var i = 0; i < text.length; i++) {
                    var charCode = text.charCodeAt(i) ^ STORAGE_KEY.charCodeAt(i % STORAGE_KEY.length);
                    result += String.fromCharCode(charCode);
                }
                return result;
            } catch (e) {
                // إذا فشل فك التشفير، أرجع البيانات الأصلية
                return encoded;
            }
        }

        // ✅ إصلاح #4: دالة آمنة للوصول إلى عناصر DOM
        function safeGetElement(id) {
            const element = document.getElementById(id);
            if (!element) {
                console.warn('العنصر غير موجود:', id);
            }
            return element;
        }

        // ✅ إصلاح #5: دالة آمنة لتعيين محتوى النص
        function safeSetText(id, text) {
            const element = safeGetElement(id);
            if (element) {
                element.textContent = String(text);
            }
        }

        // ✅ إصلاح #56: تم حذف safeSetHTML (كانت Dead Code - غير مستخدمة)

        // ✅ إصلاح #7: دالة لتنظيف المدخلات من XSS
        function sanitizeInput(input) {
            if (typeof input !== 'string') return String(input);
            return input
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#x27;');
        }

        // ✅ إصلاح #8: التحقق من صحة رقم الموقف
        function validateSpotNumber(spotNum) {
            const num = parseInt(spotNum, 10);
            return !isNaN(num) && num >= 1 && num <= 87;
        }

        // ✅ إصلاح #9: التحقق من صحة بيانات الحافلة
        function validateBusData(bus) {
            if (!bus || typeof bus !== 'object') return false;
            if (!bus.plate || typeof bus.plate !== 'string') return false;
            if (bus.pax !== undefined && (typeof bus.pax !== 'number' || bus.pax < 0)) return false;
            return true;
        }

        // ═══════════════ تهيئة النظام ═══════════════
        function init() {
            try {
                loadData();
                loadSettings();
                
                // تحميل بيانات تجريبية إذا لم توجد بيانات
                if (busData.length === 0) {
                    loadTestData();
                }
                
                // عرض المواقف والبوابات بعد تحميل البيانات
                renderParkingGrid('entranceGrid', 1, 42);
                renderParkingGrid('exitGrid', 43, 87);
                renderGates();
                updateStats();
                updateKPIs();
                updateBusLists();
                updateTime();
                
                // ✅ إصلاح #56: تنظيف intervals السابقة قبل إنشاء جديدة
                if (intervalIds.updateTime) clearInterval(intervalIds.updateTime);
                if (intervalIds.updateCountdowns) clearInterval(intervalIds.updateCountdowns);
                if (intervalIds.saveData) clearInterval(intervalIds.saveData);
                
                // حفظ معرفات intervals للتنظيف لاحقاً
                intervalIds.updateTime = setInterval(updateTime, 1000);
                intervalIds.updateCountdowns = setInterval(updateCountdowns, 1000);
                intervalIds.saveData = setInterval(saveData, 30000);
            } catch (error) {
                console.error('خطأ في تهيئة النظام:', error);
                showNotification('error', 'خطأ', 'فشل في تهيئة النظام');
            }
        }
        
        // ═══════════════ بيانات تجريبية - 20 حافلة ═══════════════
        function loadTestData() {
            try {
                const now = new Date();
                const visaTypes = ['Hajj', 'Umrah', 'Visit', 'Tourism', 'GCC', 'Work'];
                const terminals = ['HT', 'NT', 'T1'];
                const gatesArr = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2'];
                
                // 10 حافلات متأخرة (وقت المغادرة قبل 1-2 ساعة - أقل من 3 ساعات)
                for (let i = 1; i <= 10; i++) {
                    const hoursAgo = 1 + Math.random() * 2;
                    const depTime = new Date(now.getTime() - hoursAgo * 60 * 60000);
                    busData.push({
                        id: Date.now() + i,
                        plate: 'L' + (1000 + i) + 'SRA',
                        busNo: 100 + i,
                        flight: 'SV' + (1000 + i),
                        pax: 30 + Math.floor(Math.random() * 20),
                        visa: visaTypes[i % 6],
                        terminal: terminals[i % 3],
                        destination: 'مكة المكرمة',
                        departure: depTime.toISOString(),
                        arrival: new Date(now.getTime() - 8 * 60 * 60000).toISOString(),
                        spot: i,
                        gate: gatesArr[i % 10],
                        forms: { ScrSegregationIn: {}, ScrWelcomeLounge: {} }
                    });
                    dailyStats.late++;
                }
                
                // 5 حافلات في الموعد
                for (let i = 11; i <= 15; i++) {
                    const hoursLeft = 4 + Math.random() * 2;
                    const depTime = new Date(now.getTime() + hoursLeft * 60 * 60000);
                    busData.push({
                        id: Date.now() + i,
                        plate: 'O' + (1000 + i) + 'SRA',
                        busNo: 100 + i,
                        flight: 'SV' + (1000 + i),
                        pax: 30 + Math.floor(Math.random() * 20),
                        visa: visaTypes[i % 6],
                        terminal: terminals[i % 3],
                        destination: 'المدينة المنورة',
                        departure: depTime.toISOString(),
                        arrival: new Date(now.getTime() - 4 * 60 * 60000).toISOString(),
                        spot: i,
                        gate: gatesArr[i % 10],
                        forms: { ScrSegregationIn: {}, ScrWelcomeLounge: {} }
                    });
                    dailyStats.ontime++;
                }
                
                // 5 حافلات مبكر
                for (let i = 16; i <= 20; i++) {
                    const hoursLeft = 8 + Math.random() * 4;
                    const depTime = new Date(now.getTime() + hoursLeft * 60 * 60000);
                    busData.push({
                        id: Date.now() + i,
                        plate: 'E' + (1000 + i) + 'SRA',
                        busNo: 100 + i,
                        flight: 'SV' + (1000 + i),
                        pax: 30 + Math.floor(Math.random() * 20),
                        visa: visaTypes[i % 6],
                        terminal: terminals[i % 3],
                        destination: 'جدة',
                        departure: depTime.toISOString(),
                        arrival: new Date(now.getTime() - 2 * 60 * 60000).toISOString(),
                        spot: i,
                        gate: gatesArr[i % 10],
                        forms: { ScrSegregationIn: {}, ScrWelcomeLounge: {} }
                    });
                    dailyStats.early++;
                }
                
                dailyStats.buses = 20;
                dailyStats.pax = busData.reduce(function(sum, b) { return sum + (b.pax || 0); }, 0);
                busData.forEach(function(b) { dailyStats.flights.add(b.flight); });
                
                updateStats();
                renderParkingGrid('entranceGrid', 1, 42);
                renderParkingGrid('exitGrid', 43, 87);
                renderGates();
                updateKPIs();
                saveData();
                
                showNotification('success', 'بيانات تجريبية', 'تم تحميل 20 حافلة: 10 متأخرة، 5 في الموعد، 5 مبكر');
            } catch (error) {
                console.error('خطأ في تحميل البيانات التجريبية:', error);
                showNotification('error', 'خطأ', 'فشل في تحميل البيانات التجريبية');
            }
        }

        // ═══════════════ عرض شبكة المواقف ═══════════════
        function renderParkingGrid(containerId, start, end) {
            const container = safeGetElement(containerId);
            if (!container) return;
            
            container.innerHTML = '';

            for (let i = start; i <= end; i++) {
                const spot = document.createElement('div');
                spot.className = 'parking-spot';
                spot.dataset.spot = i;

                const bus = busData.find(function(b) { return b.spot === i; });

                if (bus) {
                    const status = getStatus(bus.arrival, bus.departure);
                    spot.classList.add(status.class);
                    const countdown = getCountdownString(bus.departure);

                    // ✅ إصلاح #10: استخدام sanitizeInput للبيانات المعروضة
                    spot.innerHTML = 
                        '<div class="spot-number">#' + i + '</div>' +
                        '<div class="spot-badge ' + status.class + '">' + sanitizeInput(status.label) + '</div>' +
                        '<div class="bus-info">' +
                            '<div class="info-row"><span class="info-icon">B</span>' + sanitizeInput(bus.plate) + '</div>' +
                            '<div class="info-row"><span class="info-icon">F</span>' + sanitizeInput(bus.flight) + '</div>' +
                            '<div class="info-row"><span class="info-icon">P</span>' + sanitizeInput(bus.pax || '-') + '</div>' +
                            '<div class="info-row"><span class="info-icon">G</span>' + sanitizeInput(bus.gate || '-') + '</div>' +
                        '</div>' +
                        '<div class="countdown" style="color:' + status.color + '">⏱️ ' + countdown + '</div>';

                    spot.onmouseenter = function(e) { showTooltip(e, bus, status, i); };
                    spot.onmousemove = moveTooltip;
                    spot.onmouseleave = hideTooltip;
                } else {
                    spot.classList.add('empty');
                    spot.innerHTML = '<div class="spot-number">#' + i + '</div><div class="empty-text">—</div>';
                }

                spot.onclick = function(e) { handleSpotClick(i, bus, e); };
                container.appendChild(spot);
            }
        }

        // ═══════════════ عرض البوابات المتقدم ═══════════════
        function renderGates() {
            const container = safeGetElement('gatesGrid');
            if (!container) return;
            
            container.innerHTML = '';

            gates.forEach(function(gate) {
                var gateBuses = busData.filter(function(b) { return b.gate === gate; });
                var early = 0, ontime = 0, late = 0;
                
                gateBuses.forEach(function(bus) {
                    var status = getStatus(bus.arrival, bus.departure);
                    if (status.class === 'early') early++;
                    else if (status.class === 'ontime') ontime++;
                    else late++;
                });

                var gateSection = document.createElement('div');
                gateSection.className = 'gate-section';
                
                var busesHTML = '';
                if (gateBuses.length === 0) {
                    busesHTML = '<div style="text-align:center;color:var(--text-muted);padding:10px;font-size:0.75rem;">لا توجد حافلات</div>';
                } else {
                    gateBuses.forEach(function(bus) {
                        var status = getStatus(bus.arrival, bus.departure);
                        var countdown = getCountdownString(bus.departure);
                        busesHTML += 
                            '<div class="gate-bus-card ' + status.class + '" onclick="showFormsMenu(event, ' + bus.spot + ')">' +
                                '<div style="flex:1;">' +
                                    '<div style="font-weight:700;color:var(--primary);">' + sanitizeInput(bus.plate) + '</div>' +
                                    '<div style="font-size:0.7rem;color:var(--text-muted);">' + sanitizeInput(bus.flight) + ' | ' + sanitizeInput(bus.pax || '-') + '</div>' +
                                '</div>' +
                                '<div style="text-align:left;font-size:0.75rem;">' +
                                    '<div style="color:' + status.color + ';">' + countdown + '</div>' +
                                    '<div style="font-size:0.65rem;color:var(--text-muted);">' + sanitizeInput(status.label) + '</div>' +
                                '</div>' +
                            '</div>';
                    });
                }
                
                gateSection.innerHTML = 
                    '<div class="gate-header">' +
                        '<span class="gate-title">' + sanitizeInput(gate) + '</span>' +
                        '<div class="gate-stats-mini">' +
                            '<span class="early">' + early + '</span>' +
                            '<span class="ontime">' + ontime + '</span>' +
                            '<span class="late">' + late + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="gate-buses-list" id="gateList-' + gate + '">' + busesHTML + '</div>';
                    
                container.appendChild(gateSection);
            });
        }

        // ═══════════════ حساب الحالة ═══════════════
        function getStatus(arrival, departure) {
            var now = new Date();
            var dep = new Date(departure);
            var diff = (dep - now) / (1000 * 60 * 60);

            // ✅ إصلاح #11: التحقق من صحة التاريخ
            if (isNaN(diff) || !isFinite(diff)) {
                return { class: 'late', label: 'متأخر', color: '#f44336', hours: 0 };
            }

            if (diff > thresholds.early) {
                return { class: 'early', label: 'مبكر', color: '#4caf50', hours: diff };
            } else if (diff >= thresholds.late) {
                return { class: 'ontime', label: 'موعد', color: '#2196f3', hours: diff };
            } else {
                return { class: 'late', label: 'متأخر', color: '#f44336', hours: diff };
            }
        }

        // ═══════════════ العداد التنازلي HH:MM:SS ═══════════════
        function getCountdownString(departure) {
            if (!departure) return '--:--:--';
            
            var now = new Date();
            var dep = new Date(departure);
            var diff = dep - now;
            
            // ✅ إصلاح #12: التحقق من صحة الفرق الزمني
            if (isNaN(diff) || !isFinite(diff)) return '--:--:--';
            if (diff <= 0) return '⚠️ متأخر!';
            
            var hours = Math.floor(diff / (1000 * 60 * 60));
            var mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            var secs = Math.floor((diff % (1000 * 60)) / 1000);
            
            hours = hours < 10 ? '0' + hours : hours;
            mins = mins < 10 ? '0' + mins : mins;
            secs = secs < 10 ? '0' + secs : secs;
            return hours + ':' + mins + ':' + secs;
        }

        // ═══════════════ تحديث الإحصائيات ═══════════════
        function updateStats() {
            try {
                var early = 0, ontime = 0, late = 0, totalPax = 0;
                var flights = new Set();
                var visaCounts = { Hajj: 0, Umrah: 0, Visit: 0, Tourism: 0, GCC: 0, Work: 0 };
                var visaPaxCounts = { Hajj: 0, Umrah: 0, Visit: 0, Tourism: 0, GCC: 0, Work: 0 };

                busData.forEach(function(bus) {
                    var status = getStatus(bus.arrival, bus.departure);
                    if (status.class === 'early') early++;
                    else if (status.class === 'ontime') ontime++;
                    else late++;

                    totalPax += bus.pax || 0;
                    if (bus.flight) flights.add(bus.flight);
                    if (bus.visa && visaCounts[bus.visa] !== undefined) {
                        visaCounts[bus.visa]++;
                        visaPaxCounts[bus.visa] += bus.pax || 0;
                    }
                });

                // ✅ إصلاح #13: استخدام safeSetText بدلاً من الوصول المباشر
                safeSetText('totalBuses', busData.length);
                safeSetText('earlyBuses', early);
                safeSetText('ontimeBuses', ontime);
                safeSetText('lateBuses', late);
                safeSetText('totalPax', totalPax.toLocaleString());
                safeSetText('totalFlights', flights.size);

                safeSetText('panelOccupied', busData.length);
                safeSetText('panelEmpty', 87 - busData.length);
                safeSetText('panelEarly', early);
                safeSetText('panelOntime', ontime);
                safeSetText('panelLate', late);

                // التأشيرات - الحافلات
                safeSetText('visaHajj', visaCounts.Hajj);
                safeSetText('visaUmrah', visaCounts.Umrah);
                safeSetText('visaVisit', visaCounts.Visit);
                safeSetText('visaTourism', visaCounts.Tourism);
                safeSetText('visaGCC', visaCounts.GCC);
                safeSetText('visaWork', visaCounts.Work);

                // التأشيرات - الركاب
                safeSetText('visaPaxHajj', visaPaxCounts.Hajj.toLocaleString());
                safeSetText('visaPaxUmrah', visaPaxCounts.Umrah.toLocaleString());
                safeSetText('visaPaxVisit', visaPaxCounts.Visit.toLocaleString());
                safeSetText('visaPaxTourism', visaPaxCounts.Tourism.toLocaleString());
                safeSetText('visaPaxGCC', visaPaxCounts.GCC.toLocaleString());
                safeSetText('visaPaxWork', visaPaxCounts.Work.toLocaleString());

                // الإحصائيات اليومية
                safeSetText('dailyBuses', dailyStats.buses);
                safeSetText('dailyEarly', dailyStats.early);
                safeSetText('dailyOntime', dailyStats.ontime);
                safeSetText('dailyLate', dailyStats.late);
                safeSetText('dailyPax', dailyStats.pax.toLocaleString());
                safeSetText('dailyFlights', dailyStats.flights.size);

                renderGates();
                updateBusLists();
            } catch (error) {
                console.error('خطأ في تحديث الإحصائيات:', error);
            }
        }

        // ═══════════════ تحديث الوقت ═══════════════
        function updateTime() {
            try {
                var now = new Date();
                safeSetText('currentTime', now.toLocaleTimeString('ar-SA', { hour12: false }));
                safeSetText('currentDate', now.toLocaleDateString('ar-SA'));
                safeSetText('lastUpdate', now.toLocaleTimeString('ar-SA', { hour12: false }));

                var hour = now.getHours();
                var shift, shiftColor, shiftBg;
                
                if (hour >= 6 && hour < 14) {
                    shift = 'A';
                    shiftColor = '#4caf50';
                    shiftBg = 'rgba(76,175,80,0.2)';
                } else if (hour >= 14 && hour < 22) {
                    shift = 'B';
                    shiftColor = '#2196f3';
                    shiftBg = 'rgba(33,150,243,0.2)';
                } else {
                    shift = 'C';
                    shiftColor = '#9c27b0';
                    shiftBg = 'rgba(156,39,176,0.2)';
                }
                
                var shiftBox = safeGetElement('shiftBox');
                if (shiftBox) {
                    shiftBox.style.borderColor = shiftColor;
                    shiftBox.style.background = shiftBg;
                }
                var currentShiftEl = safeGetElement('currentShift');
                if (currentShiftEl) {
                    currentShiftEl.textContent = shift;
                    currentShiftEl.style.color = shiftColor;
                }
            } catch (error) {
                console.error('خطأ في تحديث الوقت:', error);
            }
        }

        // ═══════════════ تحديث العدادات كل ثانية ═══════════════
        function updateCountdowns() {
            try {
                busData.forEach(function(bus) {
                    if (!bus.spot) return;
                    
                    var spotEl = document.querySelector('.parking-spot[data-spot="' + bus.spot + '"]');
                    if (spotEl && !spotEl.classList.contains('empty')) {
                        var countdown = getCountdownString(bus.departure);
                        var status = getStatus(bus.arrival, bus.departure);
                        var countdownEl = spotEl.querySelector('.countdown');
                        if (countdownEl) {
                            // ✅ إصلاح #54: استخدام textContent بدلاً من innerHTML
                            countdownEl.textContent = '⏱️ ' + countdown;
                            countdownEl.style.color = status.color;
                        }
                        
                        var badgeEl = spotEl.querySelector('.spot-badge');
                        if (badgeEl) {
                            badgeEl.textContent = status.label;
                            badgeEl.className = 'spot-badge ' + status.class;
                        }
                        
                        spotEl.classList.remove('early', 'ontime', 'late');
                        spotEl.classList.add(status.class);
                    }
                });
                
                monitorStatusChanges();
            } catch (error) {
                console.error('خطأ في تحديث العدادات:', error);
            }
        }

        // ═══════════════ مراقبة تغيير الحالة التلقائي ═══════════════
        function monitorStatusChanges() {
            busData.forEach(function(bus) {
                var currentStatus = getStatus(bus.arrival, bus.departure);
                var previousStatus = bus.previousStatus || currentStatus.class;
                
                if (currentStatus.class !== previousStatus) {
                    if (previousStatus === 'early' && currentStatus.class === 'ontime') {
                        showNotification('info', 'تحديث الحالة', 'الحافلة ' + sanitizeInput(bus.plate) + ' دخلت مرحلة الموعد المحدد');
                        addAlert('info', 'تغيير حالة', 'الحافلة ' + sanitizeInput(bus.plate) + ' أصبحت في الموعد');
                    }
                    
                    if (previousStatus === 'ontime' && currentStatus.class === 'late') {
                        showNotification('warning', 'تنبيه تأخير', 'الحافلة ' + sanitizeInput(bus.plate) + ' أصبحت متأخرة');
                        addAlert('warning', 'حافلة متأخرة', 'الحافلة ' + sanitizeInput(bus.plate) + ' تجاوزت الموعد المحدد');
                    }
                    
                    if (currentStatus.class === 'late' && currentStatus.hours < 1 && bus.previousHours >= 1) {
                        showNotification('error', 'حرج', 'الحافلة ' + sanitizeInput(bus.plate) + ' متأخرة جداً');
                        addAlert('critical', 'حافلة متأخرة جداً', 'الحافلة ' + sanitizeInput(bus.plate) + ' متأخرة أقل من ساعة');
                        if (settings.sound) playAlertSound();
                    }
                    
                    bus.previousStatus = currentStatus.class;
                }
                bus.previousHours = currentStatus.hours;
            });
        }

        // ═══════════════ تشغيل صوت التنبيه ═══════════════
        // ✅ إصلاح #35: صوت تنبيه صحيح وكامل
        function playAlertSound() {
            try {
                // إنشاء صوت بيب باستخدام Web Audio API
                var AudioContext = window.AudioContext || window.webkitAudioContext;
                if (!AudioContext) {
                    console.log('Web Audio API not supported');
                    return;
                }
                
                var audioCtx = new AudioContext();
                var oscillator = audioCtx.createOscillator();
                var gainNode = audioCtx.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                
                oscillator.frequency.value = 800; // تردد الصوت (هرتز)
                oscillator.type = 'sine';
                gainNode.gain.value = 0.3; // مستوى الصوت
                
                oscillator.start();
                
                // إيقاف الصوت بعد 200ms
                setTimeout(function() {
                    oscillator.stop();
                    audioCtx.close();
                }, 200);
                
            } catch(e) { 
                console.log('Sound not available:', e.message); 
            }
        }

        // ═══════════════ نافذة المعلومات ═══════════════
        function showTooltip(e, bus, status, spot) {
            var tooltip = safeGetElement('tooltip');
            if (!tooltip) return;
            
            tooltip.style.display = 'block';
            // ✅ إصلاح #14: تنظيف البيانات المعروضة في tooltip
            tooltip.innerHTML = 
                '<div class="tooltip-title">موقف #' + spot + '</div>' +
                '<div class="tooltip-row"><b>اللوحة:</b> ' + sanitizeInput(bus.plate) + '</div>' +
                '<div class="tooltip-row"><b>الرحلة:</b> ' + sanitizeInput(bus.flight) + '</div>' +
                '<div class="tooltip-row"><b>الركاب:</b> ' + sanitizeInput(bus.pax || '-') + '</div>' +
                '<div class="tooltip-row"><b>البوابة:</b> ' + sanitizeInput(bus.gate || '-') + '</div>' +
                '<div class="tooltip-row"><b>المغادرة:</b> ' + sanitizeInput(bus.departure) + '</div>' +
                '<div class="tooltip-row"><b>الوقت المتبقي:</b> ' + getCountdownString(bus.departure) + '</div>' +
                '<div class="tooltip-row" style="color:' + status.color + '"><b>الحالة:</b> ' + sanitizeInput(status.label) + '</div>';
            moveTooltip(e);
        }

        function moveTooltip(e) {
            var tooltip = safeGetElement('tooltip');
            if (!tooltip) return;
            tooltip.style.left = (e.pageX + 15) + 'px';
            tooltip.style.top = (e.pageY + 15) + 'px';
        }

        function hideTooltip() {
            var tooltip = safeGetElement('tooltip');
            if (tooltip) tooltip.style.display = 'none';
        }

        // ═══════════════ التعامل مع النقر ═══════════════
        // ✅ إصلاح #39: ربط handleSpotClick مع selectSpot في وضع التحرير
        function handleSpotClick(spot, bus, e) {
            if (editMode) {
                // في وضع التحرير، نستخدم selectSpot
                selectSpot(spot, bus);
            } else if (e) {
                showFormsMenu(e, spot, bus);
            } else {
                if (bus) {
                    showNotification('info', 'موقف #' + spot, 'الحافلة: ' + sanitizeInput(bus.plate));
                } else {
                    showNotification('info', 'موقف #' + spot, 'الموقف فارغ - انقر للإضافة');
                }
            }
        }

        // ═══════════════ الإشعارات ═══════════════
        function showNotification(type, title, message) {
            try {
                var container = safeGetElement('notifications');
                if (!container) return;
                
                var notification = document.createElement('div');
                notification.className = 'notification ' + type;
                notification.innerHTML = '<strong>' + sanitizeInput(title) + '</strong><br>' + sanitizeInput(message);
                container.appendChild(notification);

                setTimeout(function() { 
                    if (notification.parentNode) {
                        notification.remove(); 
                    }
                }, 5000);
            } catch (error) {
                console.error('خطأ في عرض الإشعار:', error);
            }
        }

        // ═══════════════ التحكم باللوحة ═══════════════
        function togglePanel() {
            panelVisible = !panelVisible;
            var panel = safeGetElement('controlPanel');
            var btn = safeGetElement('toggleBtn');
            if (panel) panel.classList.toggle('hidden', !panelVisible);
            if (btn) btn.classList.toggle('shifted', !panelVisible);
        }

        // ═══════════════ التبويبات ═══════════════
        // ✅ إصلاح #33: تمرير event كمعامل بدلاً من الاعتماد على global
        function showTab(tabName, e) {
            document.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
            document.querySelectorAll('.panel-tab').forEach(function(t) { t.classList.remove('active'); });
            var tabEl = safeGetElement('tab-' + tabName);
            if (tabEl) tabEl.classList.add('active');
            // استخدام e الممرر أو window.event للتوافق
            var evt = e || window.event;
            if (evt && evt.target) evt.target.classList.add('active');
            if (tabName === 'kpis') updateKPIs();
        }

        // ═══════════════ إعدادات الحدود ═══════════════
        function updateThresholds() {
            var earlyEl = safeGetElement('earlyThreshold');
            var lateEl = safeGetElement('lateThreshold');
            thresholds.early = parseInt(earlyEl ? earlyEl.value : 7, 10) || 7;
            thresholds.late = parseInt(lateEl ? lateEl.value : 3, 10) || 3;
            updateStats();
            renderParkingGrid('entranceGrid', 1, 42);
            renderParkingGrid('exitGrid', 43, 87);
            showNotification('success', 'الإعدادات', 'تم تحديث حدود الوقت');
        }

        // ═══════════════ إعدادات الألوان ═══════════════
        function updateColors() {
            var colorPrimary = safeGetElement('colorPrimary');
            var colorEarly = safeGetElement('colorEarly');
            var colorOntime = safeGetElement('colorOntime');
            var colorLate = safeGetElement('colorLate');
            
            if (colorPrimary) document.documentElement.style.setProperty('--primary', colorPrimary.value);
            if (colorEarly) document.documentElement.style.setProperty('--green', colorEarly.value);
            if (colorOntime) document.documentElement.style.setProperty('--blue', colorOntime.value);
            if (colorLate) document.documentElement.style.setProperty('--red', colorLate.value);
        }

        // ═══════════════ تبديل الإعدادات ═══════════════
        var settings = { sound: false, notif: true, autoRefresh: true };

        function toggleSetting(setting) {
            settings[setting] = !settings[setting];
            var toggle = safeGetElement(setting + 'Toggle');
            if (toggle) toggle.classList.toggle('active', settings[setting]);
            showNotification('info', 'الإعدادات', setting + ': ' + (settings[setting] ? 'مفعل' : 'معطل'));
        }

        // ═══════════════ حجم المواقف ═══════════════
        function updateSpotSize() {
            var spotSizeEl = safeGetElement('spotSize');
            var size = spotSizeEl ? spotSizeEl.value : 80;
            document.querySelectorAll('.parking-spot').forEach(function(spot) {
                spot.style.minHeight = size + 'px';
            });
        }

        // ═══════════════ حفظ وتحميل الإعدادات ═══════════════
        function saveSettings() {
            try {
                var settingsData = {
                    thresholds: thresholds,
                    settings: settings,
                    colors: {
                        primary: safeGetElement('colorPrimary') ? safeGetElement('colorPrimary').value : '#ffd700',
                        early: safeGetElement('colorEarly') ? safeGetElement('colorEarly').value : '#4caf50',
                        ontime: safeGetElement('colorOntime') ? safeGetElement('colorOntime').value : '#2196f3',
                        late: safeGetElement('colorLate') ? safeGetElement('colorLate').value : '#f44336'
                    },
                    spotSize: safeGetElement('spotSize') ? safeGetElement('spotSize').value : 80
                };
                // ✅ إصلاح #15: استخدام safeJSONStringify
                localStorage.setItem('LOCC_Settings', safeJSONStringify(settingsData));
                showNotification('success', 'الإعدادات', 'تم حفظ الإعدادات بنجاح');
            } catch (error) {
                console.error('خطأ في حفظ الإعدادات:', error);
                showNotification('error', 'خطأ', 'فشل في حفظ الإعدادات');
            }
        }

        function loadSettings() {
            try {
                var saved = localStorage.getItem('LOCC_Settings');
                // ✅ إصلاح #16: استخدام safeJSONParse
                var data = safeJSONParse(saved, null);
                if (data) {
                    if (data.thresholds) {
                        thresholds = data.thresholds;
                        var earlyEl = safeGetElement('earlyThreshold');
                        var lateEl = safeGetElement('lateThreshold');
                        if (earlyEl) earlyEl.value = thresholds.early;
                        if (lateEl) lateEl.value = thresholds.late;
                    }
                    if (data.settings) {
                        settings = data.settings;
                        var soundToggle = safeGetElement('soundToggle');
                        var notifToggle = safeGetElement('notifToggle');
                        var autoRefreshToggle = safeGetElement('autoRefreshToggle');
                        if (soundToggle) soundToggle.classList.toggle('active', settings.sound);
                        if (notifToggle) notifToggle.classList.toggle('active', settings.notif);
                        if (autoRefreshToggle) autoRefreshToggle.classList.toggle('active', settings.autoRefresh);
                    }
                    if (data.colors) {
                        var colorPrimary = safeGetElement('colorPrimary');
                        var colorEarly = safeGetElement('colorEarly');
                        var colorOntime = safeGetElement('colorOntime');
                        var colorLate = safeGetElement('colorLate');
                        if (colorPrimary) colorPrimary.value = data.colors.primary;
                        if (colorEarly) colorEarly.value = data.colors.early;
                        if (colorOntime) colorOntime.value = data.colors.ontime;
                        if (colorLate) colorLate.value = data.colors.late;
                        updateColors();
                    }
                    if (data.spotSize) {
                        var spotSizeEl = safeGetElement('spotSize');
                        if (spotSizeEl) spotSizeEl.value = data.spotSize;
                        updateSpotSize();
                    }
                    showNotification('success', 'الإعدادات', 'تم تحميل الإعدادات');
                }
            } catch (error) {
                console.error('خطأ في تحميل الإعدادات:', error);
            }
        }

        function resetSettings() {
            if (confirm('هل تريد إعادة تعيين جميع الإعدادات؟')) {
                localStorage.removeItem('LOCC_Settings');
                location.reload();
            }
        }

        // ═══════════════ التنبيهات ═══════════════
        var alertsList = [];

        function addAlert(type, title, message) {
            var alert = {
                id: Date.now(),
                type: type,
                title: sanitizeInput(title),
                message: sanitizeInput(message),
                time: new Date().toLocaleTimeString('ar-SA', { hour12: false })
            };
            alertsList.unshift(alert);
            if (alertsList.length > 50) alertsList.pop();
            renderAlerts();
            if (settings.notif) showNotification(type, title, message);
        }

        function renderAlerts() {
            var container = safeGetElement('alertsList');
            if (!container) return;
            
            safeSetText('alertsCount', alertsList.length);
            
            if (alertsList.length === 0) {
                container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">لا توجد تنبيهات</div>';
                return;
            }
            
            var html = '';
            alertsList.forEach(function(a) {
                html += '<div class="alert-item ' + a.type + '">' +
                    '<div class="alert-header">' +
                        '<span class="alert-title">' + a.title + '</span>' +
                        '<span class="alert-time">' + a.time + '</span>' +
                    '</div>' +
                    '<div>' + a.message + '</div>' +
                '</div>';
            });
            container.innerHTML = html;
        }

        function clearAlerts() {
            alertsList = [];
            renderAlerts();
            showNotification('info', 'التنبيهات', 'تم مسح جميع التنبيهات');
        }

        function testAlert() {
            var types = ['critical', 'warning', 'info', 'success'];
            var type = types[Math.floor(Math.random() * types.length)];
            addAlert(type, 'تنبيه تجريبي', 'هذا تنبيه تجريبي للاختبار');
        }

        // ═══════════════ مؤشرات الأداء ═══════════════
        var peakOccupancy = 0;

        function updateKPIs() {
            try {
                var total = busData.length;
                var occupancy = Math.round((total / 87) * 100);
                if (occupancy > peakOccupancy) peakOccupancy = occupancy;

                var early = 0, ontime = 0, late = 0, totalPax = 0;
                busData.forEach(function(bus) {
                    var status = getStatus(bus.arrival, bus.departure);
                    if (status.class === 'early') early++;
                    else if (status.class === 'ontime') ontime++;
                    else late++;
                    totalPax += bus.pax || 0;
                });

                var onTimeRate = total > 0 ? Math.round(((early + ontime) / total) * 100) : 0;
                var avgPax = total > 0 ? Math.round(totalPax / total) : 0;
                var avgWait = Math.round(Math.random() * 30 + 10);

                safeSetText('kpiOccupancy', occupancy + '%');
                var occupancyBar = safeGetElement('occupancyBar');
                if (occupancyBar) occupancyBar.style.width = occupancy + '%';
                
                safeSetText('kpiAvgWait', avgWait);
                safeSetText('kpiOnTimeRate', onTimeRate + '%');
                
                var onTimeBar = safeGetElement('onTimeBar');
                if (onTimeBar) {
                    onTimeBar.style.width = onTimeRate + '%';
                    onTimeBar.style.background = onTimeRate >= 80 ? 'var(--green)' : onTimeRate >= 50 ? 'var(--orange)' : 'var(--red)';
                }
                
                safeSetText('kpiAvgPax', avgPax);
                safeSetText('kpiPeakOccupancy', peakOccupancy + '%');
                safeSetText('kpiBusesToday', dailyStats.buses);
                safeSetText('kpiPaxToday', dailyStats.pax.toLocaleString());

                // تحديث الرسم البياني
                var totalStatus = early + ontime + late || 1;
                var barEarly = safeGetElement('barEarly');
                var barOntime = safeGetElement('barOntime');
                var barLate = safeGetElement('barLate');
                if (barEarly) barEarly.style.height = Math.max((early / totalStatus) * 100, 5) + '%';
                if (barOntime) barOntime.style.height = Math.max((ontime / totalStatus) * 100, 5) + '%';
                if (barLate) barLate.style.height = Math.max((late / totalStatus) * 100, 5) + '%';
            } catch (error) {
                console.error('خطأ في تحديث مؤشرات الأداء:', error);
            }
        }

        // ═══════════════ إضافة حافلة جديدة ═══════════════
        var selectedSpot = null;

        function addNewBus() {
            var spotNumEl = safeGetElement('newSpotNumber');
            var spotNum = parseInt(spotNumEl ? spotNumEl.value : 0, 10);
            
            // ✅ إصلاح #17: استخدام validateSpotNumber
            if (!validateSpotNumber(spotNum)) {
                showNotification('error', 'خطأ', 'أدخل رقم موقف صحيح (1-87)');
                return;
            }
            if (busData.find(function(b) { return b.spot === spotNum; })) {
                showNotification('error', 'خطأ', 'الموقف مشغول بالفعل');
                return;
            }
            openForm('ScrSegregationIn', spotNum);
        }

        function selectSpot(spotNum, bus) {
            selectedSpot = { num: spotNum, bus: bus };
            var spotActions = safeGetElement('spotActions');
            if (spotActions) spotActions.style.display = 'block';
            safeSetText('selectedSpotNum', spotNum);
        }

        function editSpot() {
            if (selectedSpot && selectedSpot.bus) {
                openForm('ScrSegregationIn', selectedSpot.num);
            }
        }

        // ✅ إصلاح #40: استبدال prompt بـ modal آمن
        function moveSpot() {
            if (selectedSpot && selectedSpot.bus) {
                // إنشاء modal للإدخال بدلاً من prompt
                showMoveSpotModal(selectedSpot);
            } else {
                showNotification('error', 'خطأ', 'لم يتم تحديد موقف');
            }
        }
        
        function showMoveSpotModal(spotData) {
            var modalHTML = 
                '<div class="form-group">' +
                    '<label class="form-label required">رقم الموقف الجديد (1-87)</label>' +
                    '<input type="number" class="form-input" id="newSpotInput" min="1" max="87" placeholder="أدخل رقم الموقف">' +
                '</div>' +
                '<div style="color:var(--text-muted);font-size:0.8rem;margin-top:10px;">' +
                    'الموقف الحالي: ' + spotData.num +
                '</div>';
            
            var modal = safeGetElement('modalOverlay');
            var title = safeGetElement('modalTitle');
            var body = safeGetElement('modalBody');
            var footer = modal.querySelector('.modal-footer');
            
            if (title) title.textContent = 'نقل الحافلة إلى موقف جديد';
            if (body) body.innerHTML = modalHTML;
            
            // تغيير أزرار الـ footer
            if (footer) {
                footer.innerHTML = 
                    '<button class="panel-btn primary" onclick="confirmMoveSpot()" style="flex:1;">✓ نقل</button>' +
                    '<button class="panel-btn danger" onclick="closeModal()" style="flex:1;">إلغاء</button>';
            }
            
            if (modal) modal.classList.add('active');
            
            // التركيز على حقل الإدخال
            setTimeout(function() {
                var input = safeGetElement('newSpotInput');
                if (input) input.focus();
            }, 100);
        }
        
        function confirmMoveSpot() {
            var input = safeGetElement('newSpotInput');
            if (!input) return;
            
            var newSpotNum = parseInt(input.value, 10);
            
            // ✅ التحقق من صحة الموقف الجديد
            if (!validateSpotNumber(newSpotNum)) {
                showNotification('error', 'خطأ', 'رقم الموقف يجب أن يكون بين 1 و 87');
                return;
            }
            
            if (busData.find(function(b) { return b.spot === newSpotNum; })) {
                showNotification('error', 'خطأ', 'الموقف ' + newSpotNum + ' مشغول بالفعل');
                return;
            }
            
            if (selectedSpot && selectedSpot.bus) {
                selectedSpot.bus.spot = newSpotNum;
                updateStats();
                renderParkingGrid('entranceGrid', 1, 42);
                renderParkingGrid('exitGrid', 43, 87);
                closeModal();
                showNotification('success', 'نقل', 'تم نقل الحافلة إلى الموقف ' + newSpotNum);
                
                // إعادة تعيين الموقف المحدد
                var spotActionsEl = safeGetElement('spotActions');
                if (spotActionsEl) spotActionsEl.style.display = 'none';
                selectedSpot = null;
            }
        }

        function deleteSpot() {
            if (selectedSpot && selectedSpot.bus) {
                if (confirm('هل تريد حذف هذه الحافلة؟')) {
                    busData = busData.filter(function(b) { return b.spot !== selectedSpot.num; });
                    updateStats();
                    renderParkingGrid('entranceGrid', 1, 42);
                    renderParkingGrid('exitGrid', 43, 87);
                    var spotActions = safeGetElement('spotActions');
                    if (spotActions) spotActions.style.display = 'none';
                    showNotification('warning', 'حذف', 'تم حذف الحافلة');
                }
            }
        }

        // ═══════════════ النماذج ═══════════════
        function openForm(formName, spotNum) {
            spotNum = spotNum || null;
            showNotification('info', 'النماذج', 'فتح نموذج: ' + sanitizeInput(formName) + (spotNum ? ' - موقف ' + spotNum : ''));
            currentFormName = formName;
            currentSpotForForm = spotNum;
            openFormModal(formName);
        }

        // ═══════════════ قائمة النماذج ═══════════════
        // ✅ إصلاح #32: حل Race Condition في Event Listeners
        var formsMenuClickHandler = null;
        
        function showFormsMenu(e, spotNum, bus) {
            bus = bus || null;
            e.stopPropagation();
            var menu = safeGetElement('formsMenu');
            if (!menu) return;
            
            // إزالة أي listener سابق لمنع التراكم
            if (formsMenuClickHandler) {
                document.removeEventListener('click', formsMenuClickHandler);
                formsMenuClickHandler = null;
            }
            
            currentSpotForForm = spotNum;
            currentBusForForm = bus;
            
            updateFormStatusInMenu(bus);
            
            var x = e.pageX;
            var y = e.pageY;
            if (x + 230 > window.innerWidth) x = window.innerWidth - 240;
            if (y + 300 > window.innerHeight) y = window.innerHeight - 310;
            
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            menu.classList.add('active');
            
            // إنشاء handler جديد وحفظه
            formsMenuClickHandler = function(clickEvent) {
                // التحقق من أن النقر خارج القائمة
                if (!menu.contains(clickEvent.target)) {
                    closeFormsMenu();
                }
            };
            
            // تأخير بسيط ثم إضافة listener
            setTimeout(function() {
                document.addEventListener('click', formsMenuClickHandler);
            }, 50);
        }

        function closeFormsMenu() {
            var menu = safeGetElement('formsMenu');
            if (menu) menu.classList.remove('active');
            
            // إزالة الـ listener عند الإغلاق
            if (formsMenuClickHandler) {
                document.removeEventListener('click', formsMenuClickHandler);
                formsMenuClickHandler = null;
            }
        }

        function updateFormStatusInMenu(bus) {
            var forms = ['ScrLogIn', 'ScrSegregationIn', 'ScrWelcomeLounge', 'ScrSegregationExit', 'ScrCurbside'];
            forms.forEach(function(form, i) {
                var statusEl = safeGetElement('formStatus' + (i + 1));
                if (statusEl) {
                    if (bus && bus.forms && bus.forms[form]) {
                        statusEl.textContent = 'OK';
                    } else {
                        statusEl.textContent = '⬜';
                    }
                }
            });
        }

        function selectFormFromMenu(formName) {
            closeFormsMenu();
            currentFormName = formName;
            openFormModal(formName, currentBusForForm);
        }

        // ═══════════════ النوافذ المنبثقة ═══════════════
        function openFormModal(formName, bus) {
            bus = bus || null;
            var modal = safeGetElement('modalOverlay');
            var title = safeGetElement('modalTitle');
            var body = safeGetElement('modalBody');
            if (!modal || !title || !body) return;
            
            var formTitles = {
                'ScrLogIn': 'تسجيل الدخول',
                'ScrSegregationIn': 'دخول الحافلات للفصل',
                'ScrWelcomeLounge': 'صالة الترحيب',
                'ScrSegregationExit': 'خروج الحافلات من الفصل',
                'ScrCurbside': 'الرصيف'
            };
            
            title.textContent = formTitles[formName] || formName;
            body.innerHTML = getFormHTML(formName, bus);
            modal.classList.add('active');
        }

        function getFormHTML(formName, bus) {
            bus = bus || null;
            var data = (bus && bus.forms && bus.forms[formName]) ? bus.forms[formName] : {};
            
            // تعبئة البيانات من الحافلة إذا لم تكن موجودة في النموذج
            if (bus) {
                data.BusPlate = data.BusPlate || bus.plate || '';
                data.BusNO = data.BusNO || bus.busNo || '';
                data.FlightNo = data.FlightNo || bus.flight || '';
                data.PaxCount = data.PaxCount || bus.pax || '';
                data.GetaNO = data.GetaNO || bus.gate || '';
                data.ParkNO = data.ParkNO || bus.spot || '';
            }
            
            // ✅ إصلاح #19: تنظيف جميع البيانات المعروضة في النماذج
            var safeData = {};
            for (var key in data) {
                if (data.hasOwnProperty(key)) {
                    safeData[key] = sanitizeInput(data[key]);
                }
            }
            
            var forms = {
                'ScrLogIn': getFormScrLogIn(safeData),
                'ScrSegregationIn': getFormScrSegregationIn(safeData),
                'ScrWelcomeLounge': getFormScrWelcomeLounge(safeData, bus),
                'ScrSegregationExit': getFormScrSegregationExit(safeData, bus),
                'ScrCurbside': getFormScrCurbside(safeData, bus)
            };
            
            return forms[formName] || '<p>النموذج غير متوفر</p>';
        }
        
        function getFormScrLogIn(data) {
            return '<div class="form-group">' +
                '<label class="form-label required">موقع العمل</label>' +
                '<select class="form-select" id="cmbWorkLoc">' +
                    '<option value="">اختر...</option>' +
                    '<option value="ScrLogIn"' + (data.cmbWorkLoc === 'ScrLogIn' ? ' selected' : '') + '>ScrLogIn</option>' +
                    '<option value="ScrSegregationIn"' + (data.cmbWorkLoc === 'ScrSegregationIn' ? ' selected' : '') + '>ScrSegregationIn</option>' +
                    '<option value="ScrWelcomeLounge"' + (data.cmbWorkLoc === 'ScrWelcomeLounge' ? ' selected' : '') + '>ScrWelcomeLounge</option>' +
                    '<option value="ScrSegregationExit"' + (data.cmbWorkLoc === 'ScrSegregationExit' ? ' selected' : '') + '>ScrSegregationExit</option>' +
                    '<option value="ScrCurbside"' + (data.cmbWorkLoc === 'ScrCurbside' ? ' selected' : '') + '>ScrCurbside</option>' +
                '</select>' +
            '</div>';
        }
        
        function getFormScrSegregationIn(data) {
            return '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label class="form-label required">BusPlate</label>' +
                    '<input type="text" class="form-input" id="BusPlate" value="' + (data.BusPlate || '') + '">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="form-label required">BusNO</label>' +
                    '<input type="number" class="form-input" id="BusNO" value="' + (data.BusNO || '') + '">' +
                '</div>' +
            '</div>' +
            '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label class="form-label">TripCount</label>' +
                    '<input type="number" class="form-input" id="TripCount" value="' + (data.TripCount || '') + '">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="form-label required">DepTime</label>' +
                    '<input type="datetime-local" class="form-input" id="DepTime" value="' + (data.DepTime || '') + '" step="1">' +
                '</div>' +
            '</div>' +
            '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label class="form-label required">FlightNo</label>' +
                    '<input type="text" class="form-input" id="FlightNo" value="' + (data.FlightNo || '') + '">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="form-label">CurDT</label>' +
                    '<input type="datetime-local" class="form-input" id="CurDT" value="' + (data.CurDT || new Date().toISOString().slice(0,16)) + '" step="1">' +
                '</div>' +
            '</div>' +
            '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label class="form-label required">TerminalCd</label>' +
                    '<select class="form-select" id="TerminalCd">' +
                        '<option value="">اختر...</option>' +
                        '<option value="HT"' + (data.TerminalCd === 'HT' ? ' selected' : '') + '>HT</option>' +
                        '<option value="NT"' + (data.TerminalCd === 'NT' ? ' selected' : '') + '>NT</option>' +
                        '<option value="T1"' + (data.TerminalCd === 'T1' ? ' selected' : '') + '>T1</option>' +
                    '</select>' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="form-label">TotalPax</label>' +
                    '<input type="text" class="form-input" id="TotalPax" value="' + (data.TotalPax || '') + '">' +
                '</div>' +
            '</div>' +
            '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label class="form-label required">PaxCount</label>' +
                    '<input type="number" class="form-input" id="PaxCount" value="' + (data.PaxCount || '') + '">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="form-label">Destination</label>' +
                    '<input type="text" class="form-input" id="Destination" value="' + (data.Destination || '') + '">' +
                '</div>' +
            '</div>' +
            '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label class="form-label">DispatchSts</label>' +
                    '<select class="form-select" id="DispatchSts">' +
                        '<option value="">اختر...</option>' +
                        '<option value="خاطئ"' + (data.DispatchSts === 'خاطئ' ? ' selected' : '') + '>خاطئ</option>' +
                        '<option value="مبكر"' + (data.DispatchSts === 'مبكر' ? ' selected' : '') + '>مبكر</option>' +
                        '<option value="متأخر"' + (data.DispatchSts === 'متأخر' ? ' selected' : '') + '>متأخر</option>' +
                        '<option value="مشترك رحلات"' + (data.DispatchSts === 'مشترك رحلات' ? ' selected' : '') + '>مشترك رحلات</option>' +
                        '<option value="مشترك رحلات وصالات"' + (data.DispatchSts === 'مشترك رحلات وصالات' ? ' selected' : '') + '>مشترك رحلات وصالات</option>' +
                    '</select>' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="form-label required">VisaType</label>' +
                    '<select class="form-select" id="VisaType">' +
                        '<option value="">اختر...</option>' +
                        '<option value="Hajj"' + (data.VisaType === 'Hajj' ? ' selected' : '') + '>Hajj</option>' +
                        '<option value="GCC"' + (data.VisaType === 'GCC' ? ' selected' : '') + '>GCC</option>' +
                        '<option value="Visit"' + (data.VisaType === 'Visit' ? ' selected' : '') + '>Visit</option>' +
                        '<option value="Tourism"' + (data.VisaType === 'Tourism' ? ' selected' : '') + '>Tourism</option>' +
                        '<option value="Work"' + (data.VisaType === 'Work' ? ' selected' : '') + '>Work</option>' +
                        '<option value="Umrah"' + (data.VisaType === 'Umrah' ? ' selected' : '') + '>Umrah</option>' +
                    '</select>' +
                '</div>' +
            '</div>' +
            '<div class="form-group">' +
                '<label class="form-label">UmrahCop</label>' +
                '<input type="text" class="form-input" id="UmrahCop" value="' + (data.UmrahCop || '') + '">' +
            '</div>';
        }
        
        function getFormScrWelcomeLounge(data, bus) {
            return '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label class="form-label required">BusNO</label>' +
                    '<input type="number" class="form-input" id="BusNO" value="' + ((bus && bus.busNo) || data.BusNO || '') + '" readonly style="background:#333;">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="form-label required">ParkNO</label>' +
                    '<input type="number" class="form-input" id="ParkNO" value="' + (currentSpotForForm || data.ParkNO || '') + '" min="1" max="87" placeholder="1-87">' +
                '</div>' +
            '</div>' +
            '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label class="form-label required">BusPlate</label>' +
                    '<input type="text" class="form-input" id="BusPlate" value="' + ((bus && bus.plate) || data.BusPlate || '') + '" readonly style="background:#333;">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="form-label">BagStatus</label>' +
                    '<select class="form-select" id="BagStatus">' +
                        '<option value="">اختر...</option>' +
                        '<option value="دينة"' + (data.BagStatus === 'دينة' ? ' selected' : '') + '>دينة</option>' +
                        '<option value="لا يوجد"' + (data.BagStatus === 'لا يوجد' ? ' selected' : '') + '>لا يوجد</option>' +
                        '<option value="مختلط"' + (data.BagStatus === 'مختلط' ? ' selected' : '') + '>مختلط</option>' +
                    '</select>' +
                '</div>' +
            '</div>' +
            '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label class="form-label">T3CALL</label>' +
                    '<input type="datetime-local" class="form-input" id="T3CALL" value="' + (data.T3CALL || '') + '" step="1">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="form-label">FlightSts</label>' +
                    '<select class="form-select" id="FlightSts">' +
                        '<option value="">اختر...</option>' +
                        '<option value="أقلعت"' + (data.FlightSts === 'أقلعت' ? ' selected' : '') + '>أقلعت</option>' +
                        '<option value="أُلغيت"' + (data.FlightSts === 'أُلغيت' ? ' selected' : '') + '>أُلغيت</option>' +
                        '<option value="متأخرة"' + (data.FlightSts === 'متأخرة' ? ' selected' : '') + '>متأخرة</option>' +
                        '<option value="في الموعد"' + (data.FlightSts === 'في الموعد' ? ' selected' : '') + '>في الموعد</option>' +
                    '</select>' +
                '</div>' +
            '</div>' +
            '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label class="form-label">T3ACT</label>' +
                    '<select class="form-select" id="T3ACT">' +
                        '<option value="">اختر...</option>' +
                        '<option value="Approval"' + (data.T3ACT === 'Approval' ? ' selected' : '') + '>Approval</option>' +
                        '<option value="Waiting"' + (data.T3ACT === 'Waiting' ? ' selected' : '') + '>Waiting</option>' +
                    '</select>' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="form-label required">GetaNO</label>' +
                    '<select class="form-select" id="GetaNO">' +
                        '<option value="">اختر...</option>' +
                        '<option value="A1"' + (data.GetaNO === 'A1' ? ' selected' : '') + '>A1</option>' +
                        '<option value="A2"' + (data.GetaNO === 'A2' ? ' selected' : '') + '>A2</option>' +
                        '<option value="B1"' + (data.GetaNO === 'B1' ? ' selected' : '') + '>B1</option>' +
                        '<option value="B2"' + (data.GetaNO === 'B2' ? ' selected' : '') + '>B2</option>' +
                        '<option value="C1"' + (data.GetaNO === 'C1' ? ' selected' : '') + '>C1</option>' +
                        '<option value="C2"' + (data.GetaNO === 'C2' ? ' selected' : '') + '>C2</option>' +
                        '<option value="D1"' + (data.GetaNO === 'D1' ? ' selected' : '') + '>D1</option>' +
                        '<option value="D2"' + (data.GetaNO === 'D2' ? ' selected' : '') + '>D2</option>' +
                        '<option value="E1"' + (data.GetaNO === 'E1' ? ' selected' : '') + '>E1</option>' +
                        '<option value="E2"' + (data.GetaNO === 'E2' ? ' selected' : '') + '>E2</option>' +
                    '</select>' +
                '</div>' +
            '</div>' +
            '<div class="form-group">' +
                '<label class="form-label">T3APRO</label>' +
                '<input type="datetime-local" class="form-input" id="T3APRO" value="' + (data.T3APRO || '') + '" step="1">' +
            '</div>';
        }
        
        function getFormScrSegregationExit(data, bus) {
            return '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label class="form-label required">FlightNo</label>' +
                    '<input type="text" class="form-input" id="FlightNo" value="' + ((bus && bus.flight) || data.FlightNo || '') + '">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="form-label required">BusPlate</label>' +
                    '<input type="text" class="form-input" id="BusPlate" value="' + ((bus && bus.plate) || data.BusPlate || '') + '">' +
                '</div>' +
            '</div>' +
            '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label class="form-label required">BusNO</label>' +
                    '<input type="number" class="form-input" id="BusNO" value="' + (data.BusNO || '') + '">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="form-label required">ExitDT</label>' +
                    '<input type="datetime-local" class="form-input" id="ExitDT" value="' + (data.ExitDT || new Date().toISOString().slice(0,16)) + '" step="1">' +
                '</div>' +
            '</div>' +
            '<div style="background:rgba(255,152,0,0.2);padding:10px;border-radius:6px;margin-top:10px;">' +
                '<span style="color:var(--orange);">⚠️ تحذير:</span> عند الحفظ سيتم إخلاء الموقف ونقل الحافلة لقسم البوابات' +
            '</div>';
        }
        
        function getFormScrCurbside(data, bus) {
            var gateValue = (bus && bus.gate) || data.GetaNO || '';
            return '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label class="form-label required">BusNO</label>' +
                    '<input type="number" class="form-input" id="BusNO" value="' + (data.BusNO || '') + '">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="form-label required">BusDepDT</label>' +
                    '<input type="datetime-local" class="form-input" id="BusDepDT" value="' + (data.BusDepDT || new Date().toISOString().slice(0,16)) + '" step="1">' +
                '</div>' +
            '</div>' +
            '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label class="form-label">PaxDisembarkDT</label>' +
                    '<input type="datetime-local" class="form-input" id="PaxDisembarkDT" value="' + (data.PaxDisembarkDT || '') + '" step="1">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="form-label required">BusArrDT</label>' +
                    '<input type="datetime-local" class="form-input" id="BusArrDT" value="' + (data.BusArrDT || '') + '" step="1">' +
                '</div>' +
            '</div>' +
            '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label class="form-label required">BusPlate</label>' +
                    '<input type="text" class="form-input" id="BusPlate" value="' + ((bus && bus.plate) || data.BusPlate || '') + '">' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="form-label">DelayReason</label>' +
                    '<select class="form-select" id="DelayReason">' +
                        '<option value="">اختر...</option>' +
                        '<option value="ZMZM"' + (data.DelayReason === 'ZMZM' ? ' selected' : '') + '>ZMZM</option>' +
                        '<option value="Operations"' + (data.DelayReason === 'Operations' ? ' selected' : '') + '>Operations</option>' +
                        '<option value="Bags"' + (data.DelayReason === 'Bags' ? ' selected' : '') + '>Bags</option>' +
                        '<option value="Passport Distribution"' + (data.DelayReason === 'Passport Distribution' ? ' selected' : '') + '>Passport Distribution</option>' +
                    '</select>' +
                '</div>' +
            '</div>' +
            '<div class="form-row">' +
                '<div class="form-group">' +
                    '<label class="form-label">FlightSts</label>' +
                    '<select class="form-select" id="FlightSts">' +
                        '<option value="">اختر...</option>' +
                        '<option value="أقلعت"' + (data.FlightSts === 'أقلعت' ? ' selected' : '') + '>أقلعت</option>' +
                        '<option value="أُلغيت"' + (data.FlightSts === 'أُلغيت' ? ' selected' : '') + '>أُلغيت</option>' +
                        '<option value="متأخرة"' + (data.FlightSts === 'متأخرة' ? ' selected' : '') + '>متأخرة</option>' +
                    '</select>' +
                '</div>' +
                '<div class="form-group">' +
                    '<label class="form-label required">GetaNO</label>' +
                    '<select class="form-select" id="GetaNO">' +
                        '<option value="">اختر...</option>' +
                        '<option value="A1"' + (gateValue === 'A1' ? ' selected' : '') + '>A1</option>' +
                        '<option value="A2"' + (gateValue === 'A2' ? ' selected' : '') + '>A2</option>' +
                        '<option value="B1"' + (gateValue === 'B1' ? ' selected' : '') + '>B1</option>' +
                        '<option value="B2"' + (gateValue === 'B2' ? ' selected' : '') + '>B2</option>' +
                        '<option value="C1"' + (gateValue === 'C1' ? ' selected' : '') + '>C1</option>' +
                        '<option value="C2"' + (gateValue === 'C2' ? ' selected' : '') + '>C2</option>' +
                        '<option value="D1"' + (gateValue === 'D1' ? ' selected' : '') + '>D1</option>' +
                        '<option value="D2"' + (gateValue === 'D2' ? ' selected' : '') + '>D2</option>' +
                        '<option value="E1"' + (gateValue === 'E1' ? ' selected' : '') + '>E1</option>' +
                        '<option value="E2"' + (gateValue === 'E2' ? ' selected' : '') + '>E2</option>' +
                    '</select>' +
                '</div>' +
            '</div>' +
            '<div style="background:rgba(244,67,54,0.2);padding:10px;border-radius:6px;margin-top:10px;">' +
                '<span style="color:var(--red);">⚠️ تحذير:</span> عند الحفظ سيتم إخفاء الحافلة من البوابات ونقلها لسجل الحافلات المغادرة' +
            '</div>';
        }

        function closeModal() {
            var modal = safeGetElement('modalOverlay');
            if (modal) modal.classList.remove('active');
            currentFormName = null;
            currentSpotForForm = null;
            currentBusForForm = null;
        }

        function closeModalOnOverlay(e) {
            if (e.target.id === 'modalOverlay') closeModal();
        }

        function saveFormData() {
            try {
                // جمع البيانات من النموذج
                var formData = {};
                var inputs = document.querySelectorAll('#modalBody input, #modalBody select');
                inputs.forEach(function(input) {
                    formData[input.id] = input.value;
                });
                formData.timestamp = new Date().toISOString();
                
                // معالجة حسب نوع النموذج
                if (currentFormName === 'ScrSegregationIn') {
                    // ✅ إصلاح #20: التحقق من صحة بيانات الحافلة الجديدة
                    if (!formData.BusPlate || formData.BusPlate.trim() === '') {
                        showNotification('error', 'خطأ', 'يرجى إدخال رقم لوحة الحافلة');
                        return;
                    }
                    
                    var newBus = {
                        id: Date.now(),
                        plate: formData.BusPlate.trim(),
                        busNo: formData.BusNO,
                        flight: formData.FlightNo,
                        pax: parseInt(formData.PaxCount, 10) || 0,
                        visa: formData.VisaType,
                        terminal: formData.TerminalCd,
                        destination: formData.Destination,
                        departure: formData.DepTime,
                        arrival: new Date().toISOString(),
                        tripCount: formData.TripCount,
                        totalPax: formData.TotalPax,
                        dispatchSts: formData.DispatchSts,
                        umrahCop: formData.UmrahCop,
                        curDT: formData.CurDT,
                        spot: null,
                        gate: null,
                        forms: { ScrSegregationIn: formData }
                    };
                    busData.push(newBus);
                    
                    dailyStats.buses++;
                    dailyStats.pax += newBus.pax;
                    dailyStats.flights.add(newBus.flight);
                    
                    var status = getStatus(newBus.arrival, newBus.departure);
                    if (status.class === 'early') dailyStats.early++;
                    else if (status.class === 'ontime') dailyStats.ontime++;
                    else if (status.class === 'late') dailyStats.late++;
                    
                    showNotification('success', 'ScrSegregationIn', 'تم تسجيل الحافلة ' + sanitizeInput(formData.BusPlate) + ' - اضغط عليها في قائمة "مسجلة" لتحديد الموقف');
                    
                } else if (currentFormName === 'ScrWelcomeLounge') {
                    var spotNum = parseInt(formData.ParkNO, 10);
                    
                    // ✅ إصلاح #21: التحقق من صحة رقم الموقف
                    if (!validateSpotNumber(spotNum)) {
                        showNotification('error', 'خطأ', 'يرجى تحديد رقم موقف صحيح (1-87)');
                        return;
                    }
                    
                    var existingBus = busData.find(function(b) { return b.spot === spotNum; });
                    if (existingBus && currentBusForForm && existingBus.id !== currentBusForForm.id) {
                        showNotification('error', 'خطأ', 'الموقف ' + spotNum + ' مشغول بالفعل');
                        return;
                    }
                    
                    if (currentBusForForm) {
                        var busIndex = busData.findIndex(function(b) { return b.id === currentBusForForm.id; });
                        if (busIndex !== -1) {
                            busData[busIndex].spot = spotNum;
                            busData[busIndex].gate = formData.GetaNO;
                            busData[busIndex].bagStatus = formData.BagStatus;
                            busData[busIndex].flightSts = formData.FlightSts;
                            busData[busIndex].t3call = formData.T3CALL;
                            busData[busIndex].t3act = formData.T3ACT;
                            busData[busIndex].t3apro = formData.T3APRO;
                            busData[busIndex].forms.ScrWelcomeLounge = formData;
                        }
                    }
                    
                    showNotification('success', 'ScrWelcomeLounge', 'تم تحديد الموقف ' + spotNum + ' للحافلة');
                    
                } else if (currentFormName === 'ScrSegregationExit') {
                    if (currentBusForForm) {
                        var busIndex = busData.findIndex(function(b) { return b.id === currentBusForForm.id; });
                        if (busIndex !== -1) {
                            var bus = busData[busIndex];
                            bus.exitDT = formData.ExitDT;
                            if (!bus.forms) { bus.forms = {}; }
                            bus.forms.ScrSegregationExit = formData;
                            bus.spot = null;
                        }
                    }
                    showNotification('success', 'ScrSegregationExit', 'تم إخلاء الموقف');
                    
                } else if (currentFormName === 'ScrCurbside') {
                    if (currentBusForForm) {
                        var busIndex = busData.findIndex(function(b) { return b.id === currentBusForForm.id; });
                        if (busIndex !== -1) {
                            var bus = busData.splice(busIndex, 1)[0];
                            bus.busDepDT = formData.BusDepDT;
                            bus.busArrDT = formData.BusArrDT;
                            bus.paxDisembarkDT = formData.PaxDisembarkDT;
                            bus.delayReason = formData.DelayReason;
                            if (!bus.forms) { bus.forms = {}; }
                            bus.forms.ScrCurbside = formData;
                            departedBuses.unshift(bus);
                        }
                    }
                    showNotification('success', 'ScrCurbside', 'تم تسجيل مغادرة الحافلة');
                }
                
                closeModal();
                saveData();
                updateStats();
                renderParkingGrid('entranceGrid', 1, 42);
                renderParkingGrid('exitGrid', 43, 87);
                renderGates();
                updateBusLists();
                updateKPIs();
            } catch (error) {
                console.error('خطأ في حفظ بيانات النموذج:', error);
                showNotification('error', 'خطأ', 'فشل في حفظ البيانات');
            }
        }

        // ═══════════════ تحديث قوائم الحافلات ═══════════════
        function updateBusLists() {
            updateRegisteredList();
            updateSegregationList();
            updateDepartedList();
        }

        function updateRegisteredList() {
            var list = safeGetElement('registeredList');
            if (!list) return;
            
            safeSetText('registeredCount', busData.length);
            
            if (busData.length === 0) {
                list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">لا توجد حافلات مسجلة</div>';
                return;
            }
            
            var html = '';
            busData.forEach(function(bus) {
                var status = getStatus(bus.arrival, bus.departure);
                var formsCompleted = bus.forms ? Object.keys(bus.forms).length : 1;
                // ✅ إصلاح #22: استخدام data attribute بدلاً من inline JSON
                html += '<div class="bus-card ' + status.class + '" data-bus-id="' + bus.id + '" onclick="openBusFormById(' + bus.id + ')">' +
                    '<div class="bus-card-header">' +
                        '<span class="bus-card-plate">' + sanitizeInput(bus.plate) + '</span>' +
                        '<span class="bus-card-badge ' + status.class + '">' + (bus.spot ? 'موقف ' + bus.spot : 'انتظار موقف') + '</span>' +
                    '</div>' +
                    '<div class="bus-card-info">' +
                        '<span>B: ' + sanitizeInput(bus.busNo || '-') + '</span>' +
                        '<span>F: ' + sanitizeInput(bus.flight || '-') + '</span>' +
                        '<span>P: ' + sanitizeInput(bus.pax || '-') + '</span>' +
                        '<span>G: ' + sanitizeInput(bus.gate || '-') + '</span>' +
                    '</div>' +
                    '<div class="bus-card-progress">' +
                        '<div class="bus-card-progress-fill" style="width:' + (formsCompleted * 25) + '%"></div>' +
                    '</div>' +
                '</div>';
            });
            list.innerHTML = html;
        }
        
        // ✅ إصلاح #23: دالة آمنة لفتح نموذج الحافلة بواسطة ID
        function openBusFormById(busId) {
            var bus = busData.find(function(b) { return b.id === busId; });
            if (!bus) {
                showNotification('error', 'خطأ', 'الحافلة غير موجودة');
                return;
            }
            
            currentBusForForm = bus;
            
            if (!bus.spot) {
                openFormModal('ScrWelcomeLounge', bus);
            } else if (!bus.forms || !bus.forms.ScrSegregationExit) {
                openFormModal('ScrSegregationExit', bus);
            } else {
                openFormModal('ScrCurbside', bus);
            }
        }
        
        // الدالة القديمة للتوافق مع الكود القديم
        function openBusForm(busJson) {
            try {
                // ✅ إصلاح #24: استخدام safeJSONParse
                var bus = safeJSONParse(busJson.replace(/&quot;/g, '"'), null);
                if (!bus) {
                    showNotification('error', 'خطأ', 'بيانات الحافلة غير صالحة');
                    return;
                }
                openBusFormById(bus.id);
            } catch (error) {
                console.error('خطأ في فتح نموذج الحافلة:', error);
                showNotification('error', 'خطأ', 'فشل في فتح النموذج');
            }
        }

        function updateSegregationList() {
            var list = safeGetElement('segregationList');
            if (!list) return;
            
            var segregationBuses = busData.filter(function(b) { return b.spot; });
            safeSetText('segregationCount', segregationBuses.length);
            
            if (segregationBuses.length === 0) {
                list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">لا توجد حافلات في الفرز</div>';
                return;
            }
            
            var html = '';
            segregationBuses.forEach(function(bus) {
                var status = getStatus(bus.arrival, bus.departure);
                html += '<div class="bus-card ' + status.class + '" onclick="showFormsMenu(event, ' + bus.spot + ')">' +
                    '<div class="bus-card-header">' +
                        '<span class="bus-card-plate">' + sanitizeInput(bus.plate) + '</span>' +
                        '<span class="bus-card-badge ' + status.class + '">موقف ' + bus.spot + '</span>' +
                    '</div>' +
                    '<div class="bus-card-info">' +
                        '<span>' + sanitizeInput(bus.flight) + '</span>' +
                        '<span>' + sanitizeInput(bus.pax || '-') + '</span>' +
                        '<span>' + status.hours.toFixed(1) + ' س</span>' +
                    '</div>' +
                '</div>';
            });
            list.innerHTML = html;
        }

        function updateDepartedList() {
            var list = safeGetElement('departedList');
            if (!list) return;
            
            safeSetText('departedCount', departedBuses.length);
            safeSetText('departedToday', departedBuses.length);
            
            var totalPax = departedBuses.reduce(function(s, b) { return s + (b.pax || 0); }, 0);
            safeSetText('departedPax', totalPax);
            
            if (departedBuses.length === 0) {
                list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">لا توجد حافلات غادرت</div>';
                return;
            }
            
            var html = '';
            departedBuses.slice(0, 20).forEach(function(bus) {
                html += '<div class="bus-card completed">' +
                    '<div class="bus-card-header">' +
                        '<span class="bus-card-plate">' + sanitizeInput(bus.plate) + '</span>' +
                        '<span class="bus-card-badge completed">مكتملة</span>' +
                    '</div>' +
                    '<div class="bus-card-info">' +
                        '<span>' + sanitizeInput(bus.flight) + '</span>' +
                        '<span>' + sanitizeInput(bus.pax || '-') + '</span>' +
                        '<span>' + sanitizeInput(bus.gate || '-') + '</span>' +
                    '</div>' +
                '</div>';
            });
            list.innerHTML = html;
        }

        // ═══════════════ ملء الشاشة ═══════════════
        function toggleFullscreen() {
            try {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen();
                } else {
                    document.exitFullscreen();
                }
            } catch (error) {
                console.error('خطأ في تبديل ملء الشاشة:', error);
            }
        }

        // ═══════════════ التكبير ═══════════════
        function zoomIn() { setZoom(Math.min(zoomLevel + 10, 150)); }
        function zoomOut() { setZoom(Math.max(zoomLevel - 10, 50)); }
        function zoomReset() { setZoom(100); }

        function setZoom(level) {
            zoomLevel = parseInt(level, 10);
            safeSetText('zoomLevel', zoomLevel + '%');
            var slider = safeGetElement('zoomSlider');
            if (slider) slider.value = zoomLevel;
            var contentArea = document.querySelector('.content-area');
            if (contentArea) {
                contentArea.style.transform = 'scale(' + (zoomLevel/100) + ')';
                contentArea.style.transformOrigin = 'top center';
            }
        }

        // ═══════════════ وضع التحرير ═══════════════
        function toggleEditMode() {
            editMode = !editMode;
            safeSetText('editBtn', editMode ? 'إيقاف التحرير' : 'تفعيل وضع التحرير');
            showNotification(editMode ? 'success' : 'info', 'وضع التحرير', editMode ? 'تم التفعيل' : 'تم الإيقاف');
        }

        // ═══════════════ التصدير والاستيراد ═══════════════
        function exportJSON() {
            try {
                var exportData = {
                    busData: busData,
                    dailyStats: {
                        buses: dailyStats.buses,
                        pax: dailyStats.pax,
                        early: dailyStats.early,
                        ontime: dailyStats.ontime,
                        late: dailyStats.late,
                        flights: Array.from(dailyStats.flights)
                    }
                };
                // ✅ إصلاح #25: استخدام safeJSONStringify
                var data = safeJSONStringify(exportData, '{}');
                if (data === '{}' && busData.length > 0) {
                    showNotification('error', 'خطأ', 'فشل في تصدير البيانات');
                    return;
                }
                downloadFile(data, 'LOCC_Data.json', 'application/json');
                showNotification('success', 'تصدير', 'تم تصدير البيانات بنجاح');
            } catch (error) {
                console.error('خطأ في تصدير JSON:', error);
                showNotification('error', 'خطأ', 'فشل في تصدير البيانات');
            }
        }

        function exportCSV() {
            try {
                var csv = 'الموقف,اللوحة,الرحلة,الركاب,البوابة,المغادرة,الحالة\n';
                busData.forEach(function(b) {
                    var s = getStatus(b.arrival, b.departure);
                    csv += b.spot + ',' + sanitizeInput(b.plate) + ',' + sanitizeInput(b.flight) + ',' + (b.pax || '') + ',' + (b.gate || '') + ',' + (b.departure || '') + ',' + s.label + '\n';
                });
                downloadFile(csv, 'LOCC_Data.csv', 'text/csv');
                showNotification('success', 'تصدير', 'تم تصدير CSV بنجاح');
            } catch (error) {
                console.error('خطأ في تصدير CSV:', error);
                showNotification('error', 'خطأ', 'فشل في تصدير CSV');
            }
        }

        function downloadFile(data, filename, type) {
            try {
                var blob = new Blob(['\ufeff' + data], { type: type + ';charset=utf-8' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                setTimeout(function() {
                    if (a.parentNode) document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 100);
            } catch (error) {
                console.error('خطأ في تحميل الملف:', error);
            }
        }

        function importJSON(e) {
            var file = e.target.files[0];
            if (!file) return;
            
            var reader = new FileReader();
            reader.onload = function(ev) {
                try {
                    // ✅ إصلاح #26: استخدام safeJSONParse مع التحقق
                    var d = safeJSONParse(ev.target.result, null);
                    if (!d) {
                        showNotification('error', 'خطأ', 'ملف JSON غير صالح');
                        return;
                    }
                    
                    // ✅ إصلاح #27: التحقق من بنية البيانات المستوردة
                    if (d.busData && Array.isArray(d.busData)) {
                        busData = d.busData;
                    } else if (Array.isArray(d)) {
                        busData = d;
                    } else {
                        showNotification('error', 'خطأ', 'بنية البيانات غير صحيحة');
                        return;
                    }
                    
                    if (d.dailyStats) {
                        dailyStats = {
                            buses: d.dailyStats.buses || 0,
                            pax: d.dailyStats.pax || 0,
                            early: d.dailyStats.early || 0,
                            ontime: d.dailyStats.ontime || 0,
                            late: d.dailyStats.late || 0,
                            flights: new Set(d.dailyStats.flights || [])
                        };
                    }
                    
                    updateStats();
                    renderParkingGrid('entranceGrid', 1, 42);
                    renderParkingGrid('exitGrid', 43, 87);
                    saveData();
                    showNotification('success', 'استيراد', 'تم استيراد البيانات بنجاح');
                } catch (error) {
                    console.error('خطأ في استيراد الملف:', error);
                    showNotification('error', 'خطأ', 'فشل استيراد الملف');
                }
            };
            reader.onerror = function() {
                showNotification('error', 'خطأ', 'فشل في قراءة الملف');
            };
            reader.readAsText(file);
        }

        function resetAll() {
            if (confirm('⚠️ هل أنت متأكد من حذف جميع البيانات؟')) {
                busData = [];
                dailyStats = { buses: 0, pax: 0, early: 0, ontime: 0, late: 0, flights: new Set() };
                localStorage.removeItem('LOCC_Data');
                updateStats();
                renderParkingGrid('entranceGrid', 1, 42);
                renderParkingGrid('exitGrid', 43, 87);
                showNotification('warning', 'مسح', 'تم حذف جميع البيانات');
            }
        }

        function clearAllData() {
            busData = [];
            departedBuses = [];
            dailyStats = { buses: 0, pax: 0, early: 0, ontime: 0, late: 0, flights: new Set() };
            
            updateStats();
            renderParkingGrid('entranceGrid', 1, 42);
            renderParkingGrid('exitGrid', 43, 87);
            renderGates();
            updateRegisteredList();
            updateSegregationList();
            updateDepartedList();
            updateKPIs();
            saveData();
            
            showNotification('success', 'تصفير', 'تم تصفير جميع البيانات والإحصائيات');
        }

        // ═══════════════ حفظ وتحميل البيانات ═══════════════
        // ✅ إصلاح #41: دالة بسيطة لحساب checksum
        function simpleChecksum(str) {
            var hash = 0;
            if (!str || str.length === 0) return hash.toString(16);
            for (var i = 0; i < str.length; i++) {
                var char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            return Math.abs(hash).toString(16);
        }
        
        function saveData() {
            try {
                var dataToSave = {
                    busData: busData,
                    departedBuses: departedBuses,
                    dailyStats: {
                        buses: dailyStats.buses,
                        pax: dailyStats.pax,
                        early: dailyStats.early,
                        ontime: dailyStats.ontime,
                        late: dailyStats.late,
                        flights: Array.from(dailyStats.flights)
                    }
                };
                // ✅ إصلاح #28: استخدام safeJSONStringify
                var jsonData = safeJSONStringify(dataToSave);
                // ✅ إصلاح #55: تشفير البيانات قبل التخزين
                var encryptedData = simpleEncrypt(jsonData);
                // ✅ إصلاح #41: إضافة checksum للتحقق من سلامة البيانات
                var checksum = simpleChecksum(encryptedData);
                localStorage.setItem('LOCC_Data', encryptedData);
                localStorage.setItem('LOCC_Checksum', checksum);
            } catch (error) {
                console.error('خطأ في حفظ البيانات:', error);
            }
        }

        function loadData() {
            try {
                var saved = localStorage.getItem('LOCC_Data');
                var savedChecksum = localStorage.getItem('LOCC_Checksum');
                
                // ✅ إصلاح #41: التحقق من checksum
                if (saved && savedChecksum) {
                    var calculatedChecksum = simpleChecksum(saved);
                    if (calculatedChecksum !== savedChecksum) {
                        console.warn('تحذير: تم اكتشاف تغيير في البيانات المحفوظة');
                        showNotification('warning', 'تحذير', 'تم اكتشاف تغيير غير متوقع في البيانات');
                    }
                }
                
                // ✅ إصلاح #55: فك تشفير البيانات قبل التحليل
                var decryptedData = '';
                if (saved) {
                    decryptedData = simpleDecrypt(saved);
                    // إذا فشل فك التشفير، جرب البيانات الخام (للتوافق مع البيانات القديمة)
                    if (!decryptedData || decryptedData.charAt(0) !== '{') {
                        decryptedData = saved;
                    }
                }
                
                // ✅ إصلاح #29: استخدام safeJSONParse
                var d = safeJSONParse(decryptedData, null);
                if (d) {
                    busData = d.busData || [];
                    departedBuses = d.departedBuses || [];
                    if (d.dailyStats) {
                        dailyStats = {
                            buses: d.dailyStats.buses || 0,
                            pax: d.dailyStats.pax || 0,
                            early: d.dailyStats.early || 0,
                            ontime: d.dailyStats.ontime || 0,
                            late: d.dailyStats.late || 0,
                            flights: new Set(d.dailyStats.flights || [])
                        };
                    }
                }
            } catch (error) {
                console.error('خطأ في تحميل البيانات:', error);
                busData = [];
                departedBuses = [];
                dailyStats = { buses: 0, pax: 0, early: 0, ontime: 0, late: 0, flights: new Set() };
            }
        }

        // ✅ إصلاح #31: تفعيل دالة الفلترة الفعلية
        var currentFilter = 'all';
        
        function filterBuses(type) {
            currentFilter = type;
            
            // الحصول على جميع المواقف
            var allSpots = document.querySelectorAll('.parking-spot');
            
            allSpots.forEach(function(spot) {
                var spotNum = parseInt(spot.dataset.spot, 10);
                var bus = busData.find(function(b) { return b.spot === spotNum; });
                
                if (type === 'all') {
                    // عرض الكل
                    spot.style.display = '';
                    spot.style.opacity = '1';
                } else if (!bus) {
                    // إخفاء المواقف الفارغة عند الفلترة
                    if (type === 'empty') {
                        spot.style.display = '';
                        spot.style.opacity = '1';
                    } else {
                        spot.style.opacity = '0.2';
                    }
                } else {
                    // فلترة حسب الحالة
                    var status = getStatus(bus.arrival, bus.departure);
                    if (status.class === type) {
                        spot.style.display = '';
                        spot.style.opacity = '1';
                        spot.style.transform = 'scale(1.05)';
                    } else {
                        spot.style.opacity = '0.2';
                        spot.style.transform = 'scale(1)';
                    }
                }
            });
            
            // تحديث قوائم الحافلات حسب الفلتر
            filterBusLists(type);
            
            // تحديث مظهر أزرار الفلترة
            updateFilterButtons(type);
            
            showNotification('info', 'فلترة', 'عرض: ' + (type === 'all' ? 'الكل' : type === 'early' ? 'المبكر' : type === 'ontime' ? 'في الموعد' : type === 'late' ? 'المتأخر' : type));
        }
        
        function filterBusLists(type) {
            // فلترة قائمة الحافلات المسجلة
            var registeredCards = document.querySelectorAll('#registeredList .bus-card');
            registeredCards.forEach(function(card) {
                if (type === 'all') {
                    card.style.display = '';
                } else if (card.classList.contains(type)) {
                    card.style.display = '';
                } else {
                    card.style.display = 'none';
                }
            });
            
            // فلترة قائمة حافلات الفرز
            var segregationCards = document.querySelectorAll('#segregationList .bus-card');
            segregationCards.forEach(function(card) {
                if (type === 'all') {
                    card.style.display = '';
                } else if (card.classList.contains(type)) {
                    card.style.display = '';
                } else {
                    card.style.display = 'none';
                }
            });
        }
        
        function updateFilterButtons(activeType) {
            // إزالة التحديد من جميع الأزرار
            var filterButtons = document.querySelectorAll('.stats-group .mini-stat');
            filterButtons.forEach(function(btn, index) {
                // أول 4 أزرار فقط هي أزرار الفلترة
                if (index < 4) {
                    btn.style.boxShadow = '';
                    btn.style.transform = '';
                }
            });
            
            // تحديد الزر النشط
            var activeIndex = { 'all': 0, 'early': 1, 'ontime': 2, 'late': 3 };
            if (activeIndex[activeType] !== undefined) {
                var activeBtn = filterButtons[activeIndex[activeType]];
                if (activeBtn) {
                    activeBtn.style.boxShadow = '0 0 15px var(--primary)';
                    activeBtn.style.transform = 'scale(1.1)';
                }
            }
        }
        
        // دالة لإعادة تعيين الفلتر
        function resetFilter() {
            filterBuses('all');
        }

        // ═══════════════ حجم المواقف ═══════════════
        var spotSize = 55;

        function spotSizeIn() { setSpotSize(Math.min(spotSize + 5, 100)); }
        function spotSizeOut() { setSpotSize(Math.max(spotSize - 5, 40)); }

        function setSpotSize(size) {
            spotSize = parseInt(size, 10);
            safeSetText('spotSizeLevel', spotSize + 'px');
            var slider = safeGetElement('spotSizeSlider');
            if (slider) slider.value = spotSize;
            document.querySelectorAll('.parking-spot').forEach(function(spot) {
                spot.style.minHeight = spotSize + 'px';
                spot.style.maxWidth = spotSize + 'px';
            });
        }

        // ═══════════════ بدء النظام ═══════════════
        // ✅ إصلاح #30: استخدام DOMContentLoaded بدلاً من التنفيذ المباشر
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
        
        // ✅ إصلاح #34: تصدير الدوال المطلوبة للـ onclick handlers
        window.togglePanel = togglePanel;
        window.toggleFullscreen = toggleFullscreen;
        window.filterBuses = filterBuses;
        window.showTab = showTab;
        window.zoomOut = zoomOut;
        window.zoomReset = zoomReset;
        window.zoomIn = zoomIn;
        window.setZoom = setZoom;
        window.spotSizeOut = spotSizeOut;
        window.spotSizeIn = spotSizeIn;
        window.setSpotSize = setSpotSize;
        window.toggleEditMode = toggleEditMode;
        window.addNewBus = addNewBus;
        window.editSpot = editSpot;
        window.moveSpot = moveSpot;
        window.deleteSpot = deleteSpot;
        window.exportJSON = exportJSON;
        window.exportCSV = exportCSV;
        window.importJSON = importJSON;
        window.resetAll = resetAll;
        window.clearAllData = clearAllData;
        window.loadTestData = loadTestData;
        window.updateThresholds = updateThresholds;
        window.updateColors = updateColors;
        window.toggleSetting = toggleSetting;
        window.updateSpotSize = updateSpotSize;
        window.saveSettings = saveSettings;
        window.loadSettings = loadSettings;
        window.resetSettings = resetSettings;
        window.clearAlerts = clearAlerts;
        window.testAlert = testAlert;
        window.openForm = openForm;
        window.showFormsMenu = showFormsMenu;
        window.selectFormFromMenu = selectFormFromMenu;
        window.closeModal = closeModal;
        window.closeModalOnOverlay = closeModalOnOverlay;
        window.saveFormData = saveFormData;
        window.openBusFormById = openBusFormById;
        window.openBusForm = openBusForm;
        window.resetFilter = resetFilter;
        window.confirmMoveSpot = confirmMoveSpot;
        window.selectSpot = selectSpot;
        // ═══════════════ قسم المطور ═══════════════
        function toggleDevSection() {
            var devSection = safeGetElement('devSection');
            var devTab = safeGetElement('devTab');
            
            if (!devSection || !devTab) return;
            
            var isActive = devSection.classList.contains('active');
            
            if (isActive) {
                devSection.classList.remove('active');
                devTab.classList.remove('active');
            } else {
                devSection.classList.add('active');
                devTab.classList.add('active');
            }
        }
        
        // تصدير الدالة للاستخدام في onclick
        window.toggleDevSection = toggleDevSection;
        })(window, document);
