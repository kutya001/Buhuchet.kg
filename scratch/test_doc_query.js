const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const envText = fs.readFileSync('.env.local', 'utf8');
envText.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    process.env[parts[0].trim()] = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  }
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testDoc() {
  const targetId = 'aa0778cd-fd2f-4601-b54f-b86d1d0abea8';
  console.log('Testing clean document query for:', targetId);

  const { data: doc, error } = await supabase
    .from('documents')
    .select('*, sender_company:companies!sender_company_id(id, name, inn), receiver_company:companies!receiver_company_id(id, name, inn), counterparties:counterparties!counterparty_id(id, name, inn), author:users!author_id(id, full_name, email, position)')
    .eq('id', targetId)
    .maybeSingle();

  if (error || !doc) {
    console.error('Error fetching doc:', error);
    return;
  }

  const [{ data: attachedFiles }, { data: logs }] = await Promise.all([
    supabase.from('files').select('*, file_categories(*)').eq('document_id', targetId),
    supabase.from('document_logs').select('*, user:users!user_id(full_name)').eq('document_id', targetId),
  ]);

  const fullDoc = {
    ...doc,
    files: attachedFiles || [],
    document_logs: logs || [],
  };

  console.log('--- SUCCESSFUL HYDRATED DOC ---');
  console.log('Doc Number:', fullDoc.doc_number);
  console.log('Sender:', fullDoc.sender_company?.name);
  console.log('Receiver:', fullDoc.receiver_company?.name);
  console.log('Files count:', fullDoc.files.length);
  console.log('Logs count:', fullDoc.document_logs.length);
}

testDoc();
