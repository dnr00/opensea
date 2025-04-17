import { ethers } from 'ethers';
import { FordefiWeb3Provider, FordefiProviderConfig, EvmChainId } from "@fordefi/web3-provider";
import { OpenSeaSDK, Chain } from 'opensea-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

/**
 * 환경 변수 및 설정 값
 */
const NFT_TOKEN_ID = '363077'; // 판매할 NFT의 토큰 ID
const NFT_TOKEN_ADDRESS = '0xb5f58fe2fdd79b279bf2b201f91ba784b79c8744'; // 판매할 NFT의 컨트랙트 주소
const LISTING_PRICE_ETH = '0.1'; // 판매 가격 (ETH)
const LISTING_DURATION_HOURS = 240; // 판매 유효 시간 (시간)
const PEM_KEY_PATH = '/Users/sangwook/workspace/typescript/opensea/private.pem';

/**
 * Fordefi Provider 설정 및 초기화
 */
class FordefiProviderManager {
  provider: FordefiWeb3Provider;
  ethersProvider: ethers.BrowserProvider | ethers.JsonRpcProvider;
  signer: ethers.Signer;
  walletAddress: string;
  code?: number;
  message?: string;
  chainId?: string;
  
  constructor() {
    const pemKey = fs.readFileSync(PEM_KEY_PATH, 'utf8') ?? 
      (() => { throw new Error('PEM 키를 읽을 수 없습니다') })();
    
    const config: FordefiProviderConfig = {
      chainId: EvmChainId.NUMBER_8453, // Base
      address: "0x2A7fb76E6EC0a3b329Ac3AB94dBdbAB2F0cC5c8e",
      apiUserToken: process.env.FORDEFI_API_USER_TOKEN!,
      apiPayloadSignKey: pemKey,
      rpcUrl: "https://base-mainnet.g.alchemy.com/v2/sA2ayOK8MT4fMosd38djWYYseUK8toHM"
    };
    
    this.walletAddress = config.address;
    this.provider = new FordefiWeb3Provider(config);
    
    // ethers v6 변경사항 반영
    this.ethersProvider = new ethers.BrowserProvider(this.provider as any);
    this.signer = this.ethersProvider.getSigner() as unknown as ethers.Signer;
  }
  
  /**
   * EIP-1193 이벤트 등록 및 Provider 연결
   */
  async connect() {
    console.log("Fordefi Provider에 연결 중...");
    
    // 체인 변경 이벤트 핸들링
    this.provider.on("chainChanged", (chainId: string) => {
      console.log("체인 변경됨:", chainId);
    });
    
    // 계정 변경 이벤트 핸들링
    this.provider.on("accountsChanged", (accounts: string[]) => {
      console.log("계정 변경됨:", accounts[0]);
    });
    
    // 연결 이벤트 핸들링
    this.provider.on("connect", ({ chainId }) => {
      console.log("Provider 연결됨, 체인 ID:", chainId);
    });
    
    // 연결 해제 이벤트 핸들링
    this.provider.on("disconnect", (error: { code: number; message: string }) => {
      this.code = error.code;
      this.message = error.message;
      console.log("Provider 연결 해제됨:", error.message);
    });
    
    try {
      // Provider 연결 요청
      await this.provider.request({ method: "eth_requestAccounts" });
      
      // 연결된 체인 ID 확인
      const chainId = await this.provider.request({ method: "eth_chainId" });
      this.chainId = chainId;
      
      // 현재 계정 가져오기
      const accounts = await this.provider.request({ method: "eth_accounts" });
      const account = accounts[0];
      
      // Signer 업데이트
      this.signer = await this.ethersProvider.getSigner();
      
      console.log("Fordefi Provider에 성공적으로 연결됨");
      console.log("사용 중인 지갑 주소:", account);
      
      return this.signer;
    } catch (error: any) {
      console.error("Fordefi Provider 연결 중 오류 발생:", error.message || error);
      throw error;
    }
  }
  
  /**
   * Provider 연결 해제
   */
  async disconnect() {
    await this.provider.disconnect();
    console.log("Fordefi Provider 연결 해제됨");
  }
}

/**
 * OpenSea NFT 리스팅 관리 클래스
 */
class OpenSeaNFTLister {
  openseaSDK: OpenSeaSDK;
  signer: ethers.Signer;
  walletAddress: string;
  
  constructor(signer: ethers.Signer, walletAddress: string) {
    this.signer = signer;
    this.walletAddress = walletAddress;
    
    // OpenSea SDK 초기화
    this.openseaSDK = new OpenSeaSDK(signer as any, {
      chain: Chain.Base,
      apiKey: process.env.OPENSEA_API_KEY!,
    });
  }
  
  /**
   * NFT 소유권 확인
   */
  async verifyOwnership(tokenAddress: string, tokenId: string) {
    try {
      console.log(`NFT 소유권 확인 중: ${tokenAddress} #${tokenId}`);
      
      // ERC721 기본 인터페이스
      const erc721Interface = [
        'function ownerOf(uint256 tokenId) view returns (address)'
      ];
      
      const nftContract = new ethers.Contract(tokenAddress, erc721Interface, this.signer);
      const owner = await nftContract.ownerOf(tokenId);
      
      const ownsNFT = owner.toLowerCase() === this.walletAddress.toLowerCase();
      console.log(`NFT 소유자: ${owner}`);
      
      if (!ownsNFT) {
        throw new Error(`해당 NFT를 소유하고 있지 않습니다. 소유자: ${owner}`);
      }
      
      return true;
    } catch (error: any) {
      console.error('NFT 소유권 확인 중 오류 발생:', error.message || error);
      throw error;
    }
  }
  
  /**
   * NFT 판매 리스팅 생성
   */
  async createNFTListing(tokenAddress: string, tokenId: string, priceEth: string, expirationHours: number) {
    try {
      console.log(`NFT 판매 리스팅 생성 중: ${tokenAddress} #${tokenId}`);
      
      // NFT 소유권 확인
      await this.verifyOwnership(tokenAddress, tokenId);
      
      // 만료 시간 설정 (현재 시간 + expirationHours)
      const expirationTime = Math.round(Date.now() / 1000 + expirationHours * 60 * 60);
      
      // NFT 리스팅 생성
      const listing = await this.openseaSDK.createListing({
        asset: {
          tokenId,
          tokenAddress,
        },
        accountAddress: this.walletAddress,
        startAmount: parseFloat(priceEth),
        expirationTime,
      });
      
      console.log('NFT 판매 리스팅이 성공적으로 생성되었습니다!');
      console.log('리스팅 상세 정보:', listing);
      
      return listing;
    } catch (error: any) {
      console.error('NFT 판매 리스팅 생성 중 오류 발생:', error.message || error);
      throw error;
    }
  }
}

/**
 * 메인 함수: NFT 판매 리스팅 프로세스
 */
async function listNFTForSale() {
  const fordefiManager = new FordefiProviderManager();
  
  try {
    // 1. Fordefi Provider 연결
    const signer = await fordefiManager.connect();
    
    // 2. OpenSea 리스팅 매니저 초기화
    const lister = new OpenSeaNFTLister(signer, fordefiManager.walletAddress);
    
    // 3. NFT 판매 리스팅 생성
    await lister.createNFTListing(
      NFT_TOKEN_ADDRESS,
      NFT_TOKEN_ID,
      LISTING_PRICE_ETH,
      LISTING_DURATION_HOURS
    );
    
    console.log('NFT 판매 리스팅 프로세스가 성공적으로 완료되었습니다!');
  } catch (error: any) {
    // 오류 처리
    if (error?.message?.includes('소유하고 있지 않습니다')) {
      console.error('소유권 오류:', error.message);
      console.log('다음을 확인해보세요:');
      console.log('1. NFT의 토큰 ID가 올바른지');
      console.log('2. NFT의 컨트랙트 주소가 올바른지');
      console.log('3. 해당 NFT를 지갑에서 소유하고 있는지');
    } else if (error?.message?.includes('승인이 필요합니다')) {
      console.error('승인 오류:', error.message);
      console.log('OpenSea에서 NFT 판매 승인이 필요합니다.');
    } else {
      console.error('오류 발생:', error.message || error);
    }
  } finally {
    // 항상 Provider 연결 해제
    await fordefiManager.disconnect();
  }
}

// NFT 판매 리스팅 함수 실행
listNFTForSale();
