//+------------------------------------------------------------------+
//|                                                 TradeLogSync.mq5 |
//|  Sends your MT5 positions to your TradeLog journal.              |
//|                                                                  |
//|  Read-only: it never opens, closes or modifies orders.           |
//|                                                                  |
//|  Setup                                                           |
//|  1. Copy this file to  File > Open Data Folder > MQL5\Experts    |
//|  2. Tools > Options > Expert Advisors > tick "Allow WebRequest   |
//|     for listed URL" and add your TradeLog address, e.g.          |
//|     https://your-app.vercel.app                                  |
//|  3. Drag TradeLogSync onto any chart, paste the Sync URL and API |
//|     key from TradeLog > Settings > MetaTrader 5, and turn on     |
//|     Algo Trading.                                                |
//+------------------------------------------------------------------+
#property copyright   "TradeLog"
#property version     "1.00"
#property description "Syncs closed and open positions to your TradeLog trading journal."

input string InpApiUrl      = "https://your-app.vercel.app/api/mt5/trades"; // Sync URL (from TradeLog > Settings)
input string InpApiKey      = "";   // API key (from TradeLog > Settings)
input int    InpHistoryDays = 90;   // Days of history to send on the first run
input int    InpIntervalSec = 60;   // Sync every N seconds
input bool   InpSendOpen    = true; // Also send open positions

#define BATCH_SIZE 100

string   g_lastVar;          // terminal global variable holding the last successful sync time
datetime g_lastRun = 0;
bool     g_pending = true;   // set when a deal happens, so we sync right away

//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(InpApiKey) < 10 || StringFind(InpApiUrl, "http") != 0)
     {
      Alert("TradeLog: paste the Sync URL and API key from TradeLog > Settings into the EA inputs.");
      return(INIT_PARAMETERS_INCORRECT);
     }
   g_lastVar = "TradeLog_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "_last";
   EventSetTimer(5);
   Print("TradeLog: started for account ", AccountInfoInteger(ACCOUNT_LOGIN), ". Syncing to ", InpApiUrl);
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTick() {}

void OnTimer()
  {
   if(g_pending || TimeLocal() - g_lastRun >= MathMax(InpIntervalSec, 15))
      Sync();
  }

void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
  {
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD || trans.type == TRADE_TRANSACTION_POSITION)
      g_pending = true;
  }

//+------------------------------------------------------------------+
//| Helpers                                                          |
//+------------------------------------------------------------------+
string JsonStr(string s)
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\n", " ");
   StringReplace(s, "\t", " ");
   return("\"" + s + "\"");
  }

string Num(double v, int digits = 8) { return(DoubleToString(v, digits)); }

// "2026.07.01 10:05" (broker server time)
string FmtTime(datetime t) { return(JsonStr(TimeToString(t, TIME_DATE | TIME_MINUTES))); }

void AddUnique(ulong &arr[], ulong v)
  {
   int n = ArraySize(arr);
   for(int i = 0; i < n; i++)
      if(arr[i] == v)
         return;
   ArrayResize(arr, n + 1);
   arr[n] = v;
  }

//+------------------------------------------------------------------+
//| Builds the JSON for one position from all of its deals.          |
//| Returns "" if the position has no entry deal in history.         |
//+------------------------------------------------------------------+
string PositionJson(ulong positionId)
  {
   if(!HistorySelectByPosition(positionId))
      return("");

   string   symbol = "", comment = "";
   long     inType = -1;
   datetime openTime = 0, closeTime = 0;
   double   inVol = 0, inValue = 0, outVol = 0, outValue = 0;
   double   profit = 0, commission = 0, swap = 0, fee = 0;
   double   sl = 0, tp = 0;

   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0)
         continue;
      long type = HistoryDealGetInteger(ticket, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL)
         continue;

      long     entry  = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      double   volume = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      double   price  = HistoryDealGetDouble(ticket, DEAL_PRICE);
      datetime time   = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);

      commission += HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      swap       += HistoryDealGetDouble(ticket, DEAL_SWAP);
      fee        += HistoryDealGetDouble(ticket, DEAL_FEE);
      profit     += HistoryDealGetDouble(ticket, DEAL_PROFIT);

      if(entry == DEAL_ENTRY_IN)
        {
         if(inType < 0)
           {
            inType   = type;
            symbol   = HistoryDealGetString(ticket, DEAL_SYMBOL);
            comment  = HistoryDealGetString(ticket, DEAL_COMMENT);
            openTime = time;
           }
         inVol   += volume;
         inValue += volume * price;
         if(sl == 0) sl = HistoryDealGetDouble(ticket, DEAL_SL);
         if(tp == 0) tp = HistoryDealGetDouble(ticket, DEAL_TP);
        }
      else // DEAL_ENTRY_OUT, DEAL_ENTRY_OUT_BY, DEAL_ENTRY_INOUT
        {
         outVol   += volume;
         outValue += volume * price;
         if(time > closeTime) closeTime = time;
         double dsl = HistoryDealGetDouble(ticket, DEAL_SL);
         double dtp = HistoryDealGetDouble(ticket, DEAL_TP);
         if(dsl > 0) sl = dsl;
         if(dtp > 0) tp = dtp;
        }
     }
   if(inType < 0 || inVol <= 0)
      return("");

   // Still open? Use the live position for size and current stop/target.
   bool open = PositionSelectByTicket(positionId);
   if(open)
     {
      sl = PositionGetDouble(POSITION_SL);
      tp = PositionGetDouble(POSITION_TP);
      swap = PositionGetDouble(POSITION_SWAP) + swap;
     }
   bool closed = !open && outVol > 0;

   double contract = SymbolInfoDouble(symbol, SYMBOL_TRADE_CONTRACT_SIZE);
   if(contract <= 0) contract = 1;

   string j = "{";
   j += "\"position_id\":\"" + IntegerToString((long)positionId) + "\"";
   j += ",\"symbol\":" + JsonStr(symbol);
   j += ",\"path\":" + JsonStr(SymbolInfoString(symbol, SYMBOL_PATH));
   j += ",\"type\":" + (inType == DEAL_TYPE_BUY ? "\"buy\"" : "\"sell\"");
   j += ",\"volume\":" + Num(inVol, 4);
   j += ",\"contract_size\":" + Num(contract, 4);
   j += ",\"open_time\":" + FmtTime(openTime);
   j += ",\"open_price\":" + Num(inValue / inVol);
   if(closed)
     {
      j += ",\"close_time\":" + FmtTime(closeTime);
      j += ",\"close_price\":" + Num(outValue / outVol);
      j += ",\"profit\":" + Num(profit, 2);
     }
   j += ",\"sl\":" + Num(sl);
   j += ",\"tp\":" + Num(tp);
   j += ",\"commission\":" + Num(commission, 2);
   j += ",\"swap\":" + Num(swap, 2);
   j += ",\"fee\":" + Num(fee, 2);
   j += ",\"comment\":" + JsonStr(comment);
   j += "}";
   return(j);
  }

//+------------------------------------------------------------------+
bool Post(string json, string &reply)
  {
   char   data[], result[];
   string resultHeaders;
   int n = StringToCharArray(json, data, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(data, n - 1); // drop the trailing \0

   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + InpApiKey + "\r\n";
   ResetLastError();
   int code = WebRequest("POST", InpApiUrl, headers, 20000, data, result, resultHeaders);
   reply = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);

   if(code == -1)
     {
      int err = GetLastError();
      if(err == 4014)
         Print("TradeLog: MT5 blocked the request. Add your TradeLog address under Tools > Options > Expert Advisors > Allow WebRequest for listed URL.");
      else
         Print("TradeLog: could not reach ", InpApiUrl, " (error ", err, "). Check the URL and your internet connection.");
      return(false);
     }
   if(code != 200)
     {
      Print("TradeLog: server returned HTTP ", code, ": ", reply);
      return(false);
     }
   return(true);
  }

//+------------------------------------------------------------------+
void Sync()
  {
   g_lastRun = TimeLocal();
   g_pending = false;
   datetime startedAt = TimeCurrent();

   // Re-send the last 2 days on every run so late changes (partial closes, swaps) are picked up.
   datetime from = TimeCurrent() - (datetime)InpHistoryDays * 86400;
   if(GlobalVariableCheck(g_lastVar))
      from = (datetime)GlobalVariableGet(g_lastVar) - 2 * 86400;

   ulong ids[];
   if(HistorySelect(from, TimeCurrent() + 86400))
     {
      int total = HistoryDealsTotal();
      for(int i = 0; i < total; i++)
        {
         ulong ticket = HistoryDealGetTicket(i);
         if(ticket == 0)
            continue;
         long type = HistoryDealGetInteger(ticket, DEAL_TYPE);
         if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL)
            continue;
         if(HistoryDealGetInteger(ticket, DEAL_ENTRY) == DEAL_ENTRY_IN && !InpSendOpen)
            continue;
         AddUnique(ids, (ulong)HistoryDealGetInteger(ticket, DEAL_POSITION_ID));
        }
     }
   if(InpSendOpen)
      for(int i = PositionsTotal() - 1; i >= 0; i--)
         if(PositionGetTicket(i) > 0)
            AddUnique(ids, (ulong)PositionGetInteger(POSITION_IDENTIFIER));

   string header = "{\"login\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\""
                   + ",\"server\":" + JsonStr(AccountInfoString(ACCOUNT_SERVER))
                   + ",\"currency\":" + JsonStr(AccountInfoString(ACCOUNT_CURRENCY))
                   + ",\"positions\":[";

   int count = ArraySize(ids), sent = 0, inBatch = 0;
   string batch = "";
   bool ok = true;
   for(int i = 0; i < count && ok; i++)
     {
      string p = PositionJson(ids[i]);
      if(p == "")
         continue;
      batch += (inBatch > 0 ? "," : "") + p;
      inBatch++;
      if(inBatch == BATCH_SIZE || i == count - 1)
        {
         string reply;
         ok = Post(header + batch + "]}", reply);
         if(ok) sent += inBatch;
         batch = "";
         inBatch = 0;
        }
     }
   if(ok && inBatch > 0) // last ids were skipped after the final full batch
     {
      string reply;
      ok = Post(header + batch + "]}", reply);
      if(ok) sent += inBatch;
     }
   if(ok && count == 0) // still ping the server so TradeLog shows the account as connected
     {
      string reply;
      ok = Post(header + "]}", reply);
     }

   if(ok)
     {
      GlobalVariableSet(g_lastVar, (double)startedAt);
      if(sent > 0)
         Print("TradeLog: synced ", sent, " position(s).");
     }
   // On failure, the next scheduled run (InpIntervalSec) retries from the same point.
  }
//+------------------------------------------------------------------+
