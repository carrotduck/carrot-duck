// Authenticated text-render receipts, not raw robot commands or motion authority.
export function createBodyEventStore(db, rehearsal, clock = Date.now) {
  db.exec(`CREATE TABLE IF NOT EXISTS rehearsal_body_sessions (
    take_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, heartbeat_ms INTEGER NOT NULL,
    closed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS rehearsal_body_events (
    take_id TEXT NOT NULL, sequence INTEGER NOT NULL, event TEXT NOT NULL,
    receipt TEXT NOT NULL, PRIMARY KEY(take_id,sequence), UNIQUE(take_id,event));
    CREATE TABLE IF NOT EXISTS rehearsal_body_device (
    take_id TEXT NOT NULL, step INTEGER NOT NULL, status TEXT NOT NULL,
    receipt TEXT NOT NULL, PRIMARY KEY(take_id,step));`);
  const fail = (message, status=409) => Object.assign(new Error(message), {status});
  db.exec(`CREATE TABLE IF NOT EXISTS rehearsal_executor (user_id TEXT PRIMARY KEY, seen_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rehearsal_launch (take_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL, updated_ms INTEGER NOT NULL, message TEXT NOT NULL DEFAULT '');`);
  function executor(user,b) {
    if(b.command==='executor_poll') {
      db.prepare('INSERT INTO rehearsal_executor VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET seen_ms=excluded.seen_ms').run(user,clock());
      const a=rehearsal.active(user);if(!a)return {take_id:null};
      const q=db.prepare("SELECT * FROM rehearsal_launch WHERE take_id=? AND user_id=? AND status='queued'").get(a.id,user);
      if(!q)return {take_id:null};
      try {session(user,a.id);}catch{return {take_id:null};}
      if(a.step!==0||clock()-q.updated_ms>15000)return {take_id:null};
      db.prepare("UPDATE rehearsal_launch SET status='claimed',updated_ms=? WHERE take_id=? AND status='queued'").run(clock(),a.id);
      return {take_id:a.id};
    }
    if(b.command==='launch') {
      session(user,b.take_id);
      if(active(user,b.take_id).step!==0)throw fail('Start a fresh take');
      const online=db.prepare('SELECT seen_ms FROM rehearsal_executor WHERE user_id=?').get(user);
      if(!online||clock()-online.seen_ms>5000)throw fail('小机执行端未连接，请确认小机已开机');
      if(db.prepare('SELECT 1 FROM rehearsal_launch WHERE take_id=?').get(b.take_id))throw fail('This take has already been launched');
      db.prepare("INSERT INTO rehearsal_launch(take_id,user_id,status,updated_ms) VALUES(?,?,'queued',?)").run(b.take_id,user,clock());
      return {take_id:b.take_id,status:'queued'};
    }
    if(b.command==='executor_result') {
      if(!['completed','ended','failed','running'].includes(b.status))throw fail('Invalid executor status',400);
      const q=db.prepare('SELECT * FROM rehearsal_launch WHERE take_id=? AND user_id=?').get(b.take_id,user);
      if(!q||!['claimed','running'].includes(q.status))throw fail('Take is not claimed');
      db.prepare('UPDATE rehearsal_launch SET status=?,updated_ms=?,message=? WHERE take_id=?').run(b.status,clock(),String(b.message||'').slice(0,180),b.take_id);
      return {ok:true};
    }
    throw fail('Unknown executor command',400);
  }
  function active(user, take) {
    const a = rehearsal.active(user);
    if (!a || a.id !== take || a.scene !== 'small_gesture_of_care' || a.paused) throw fail('Body rehearsal is not active');
    return a;
  }
  function session(user, take) {
    active(user,take);
    const s=db.prepare('SELECT * FROM rehearsal_body_sessions WHERE take_id=? AND user_id=?').get(take,user);
    if (!s || s.closed || clock()-s.heartbeat_ms>3500) throw fail('Body session disconnected; start a new take');
    return s;
  }
  function open(user,take) {
    if(active(user,take).step!==0)throw fail('Open body session before the first line');
    if(db.prepare('SELECT 1 FROM rehearsal_body_sessions WHERE take_id=?').get(take))throw fail('Start a new take; sessions cannot replay');
    db.prepare('INSERT INTO rehearsal_body_sessions(take_id,user_id,heartbeat_ms) VALUES(?,?,?)').run(take,user,clock());
    return {take_id:take,mode:'receipts_only'};
  }
  function heartbeat(user,take) {
    session(user,take);
    db.prepare('UPDATE rehearsal_body_sessions SET heartbeat_ms=? WHERE take_id=?').run(clock(),take);
    const latest=db.prepare('SELECT receipt FROM rehearsal_body_device WHERE take_id=? ORDER BY step DESC LIMIT 1').get(take);
    const withdrawn=!!db.prepare("SELECT 1 FROM rehearsal_body_events WHERE take_id=? AND event='hand_withdrawn'").get(take);
    const receipts=db.prepare('SELECT receipt FROM rehearsal_body_device WHERE take_id=? ORDER BY step').all(take).map(r=>JSON.parse(r.receipt));
    const execution=db.prepare('SELECT status,message FROM rehearsal_launch WHERE take_id=? AND user_id=?').get(take,user)||null;
    return {ok:true,device_receipt:latest?JSON.parse(latest.receipt):null,device_receipts:receipts,execution,hand_withdrawn:withdrawn};
  }
  function close(user,take) {
    db.prepare('UPDATE rehearsal_body_sessions SET closed=1 WHERE take_id=? AND user_id=?').run(take,user);
    return {ok:true};
  }
  function commit(user, body) {
    const take=body.take_id;session(user,take);
    const events=['happy_reply','hand_withdrawn','hug_reply'];
    if(!events.includes(body.event))throw fail('Unknown body event',400);
    const existing=db.prepare('SELECT receipt FROM rehearsal_body_events WHERE take_id=? AND event=?').get(take,body.event);
    let receipt;
    if(body.event==='hand_withdrawn') {
      if(!['operator','camera','choreography'].includes(body.source))throw fail('Withdrawal requires operator, camera or explicit choreography cue',400);
      if(body.source==='choreography'){
        const beat=db.prepare("SELECT receipt FROM rehearsal_body_device WHERE take_id=? AND step=17 AND status='completed'").get(take);
        if(body.completed_step!==17||!beat||clock()-JSON.parse(beat.receipt).received_at<3000)throw fail('Wait for the completed choreography beat');
      }
      if(body.source==='camera' && (!Number.isInteger(body.seen_frames)||body.seen_frames<3||body.seen_frames>1000
        ||!Number.isInteger(body.absent_ms)||body.absent_ms<900||body.absent_ms>30000
        ||!Number.isInteger(body.observation_age_ms)||body.observation_age_ms<0||body.observation_age_ms>350))
        throw fail('Invalid camera withdrawal evidence',400);
      receipt={event:body.event,source:body.source,take_id:take,user_id:user,
        ...(body.source==='choreography'?{completed_step:17,pause_ms:3000,physical_withdrawal_observed:false}:{}),
        ...(body.source==='camera'?{seen_frames:body.seen_frames,absent_ms:body.absent_ms,observation_age_ms:body.observation_age_ms}:{})};
    } else {
      const cached=db.prepare('SELECT response FROM rehearsal_requests WHERE take_id=? AND request_id=?').get(take,body.request_id);
      const source=cached && JSON.parse(cached.response).body_sync;
      if(!source || source.mode!=='preview_only' || source.cue+'_reply'!==body.event || source.user_id!==user)throw fail('No matching rehearsal reply');
      for(const key of ['user_message_id','assistant_message_id','reply_to_message_id','user_text','assistant_text']) {
        if(source[key]!==body[key])throw fail('Text receipt does not match stored reply');
      }
      if(!Number.isFinite(source.expires_at)||source.expires_at<=clock())throw fail('Reply expired');
      receipt={...source,event:body.event,source:'web_text_committed'};
    }
    if(existing)return JSON.parse(existing.receipt);
    const count=db.prepare('SELECT count(*) n FROM rehearsal_body_events WHERE take_id=?').get(take).n;
    if(events[count]!==body.event)throw fail('Wait for the preceding body event');
    receipt={...receipt,schema:'duck-body-receipt/v1',mode:'receipts_only',sequence:count+1,committed_at:clock(),expires_at:Math.min(receipt.expires_at??Infinity,clock()+120000)};
    db.prepare('INSERT INTO rehearsal_body_events(take_id,sequence,event,receipt) VALUES(?,?,?,?)').run(take,receipt.sequence,receipt.event,JSON.stringify(receipt));
    return receipt;
  }
  function read(user,take,after=0) {
    session(user,take);
    if(!Number.isInteger(after)||after<0||after>3)throw fail('Invalid cursor',400);
    const events=db.prepare('SELECT receipt FROM rehearsal_body_events WHERE take_id=? AND sequence>? ORDER BY sequence').all(take,after).map(r=>JSON.parse(r.receipt));
    if(events.some(e=>e.expires_at<=clock()))throw fail('Unconsumed receipt expired');
    return {take_id:take,mode:'receipts_only',events};
  }
  function ack(user,b) {
    session(user,b.take_id);
    if(!Number.isInteger(b.step)||b.step<0||b.step>30||b.action_id!==`${b.take_id}:${b.step}`||!['started','completed','failed'].includes(b.status))throw fail('Invalid device receipt',400);
    const old=db.prepare('SELECT status,receipt FROM rehearsal_body_device WHERE take_id=? AND step=?').get(b.take_id,b.step);
    if(old?.status===b.status)return JSON.parse(old.receipt);
    if(b.status==='started'){
      if(old)throw fail('Device action cannot replay');
      if(b.step>0&&db.prepare('SELECT status FROM rehearsal_body_device WHERE take_id=? AND step=?').get(b.take_id,b.step-1)?.status!=='completed')throw fail('Previous device action incomplete');
    }else if(old?.status!=='started')throw fail('Device action was not started');
    if(b.status==='completed'){
      if(!b.arms_verified||!b.positions||Object.keys(b.positions).sort().join(',')!=='14,15,16,6,7,8'||Object.values(b.positions).some(v=>!Number.isInteger(v)||v<0||v>1000))throw fail('Missing verified arm positions',400);
      if(b.head_status!=='command_time_elapsed')throw fail('Missing head command timing',400);
      if([6,21].includes(b.step)&&b.audio_status!=='process_completed')throw fail('Missing vocalization completion',400);
    }
    const receipt={take_id:b.take_id,action_id:b.action_id,step:b.step,status:b.status,label:String(b.label||'').slice(0,100),
      positions:b.status==='completed'?b.positions:null,arms_verified:b.status==='completed',head_status:b.head_status||null,
      audio_status:b.audio_status||null,error:String(b.error||'').slice(0,200),received_at:clock()};
    db.prepare('INSERT INTO rehearsal_body_device(take_id,step,status,receipt) VALUES(?,?,?,?) ON CONFLICT(take_id,step) DO UPDATE SET status=excluded.status,receipt=excluded.receipt').run(b.take_id,b.step,b.status,JSON.stringify(receipt));
    return receipt;
  }
  return {open,heartbeat,close,commit,read,ack,executor};
}
